'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 2;
const DISCORD_ID_PATTERN = /^\d{17,20}$/;

function normalizeUuid(uuid) {
	return typeof uuid === 'string' ? uuid.replaceAll('-', '').toLowerCase() : '';
}

function isValidUuid(uuid) {
	return /^[0-9a-f]{32}$/.test(normalizeUuid(uuid));
}

function toUser(row) {
	return row ? { ...row } : undefined;
}

function tableExists(database, name) {
	return Boolean(database.prepare(`
		SELECT 1
		FROM sqlite_schema
		WHERE type = 'table' AND name = ?
	`).get(name));
}

function tableColumns(database, name) {
	return new Set(database.prepare(`PRAGMA table_info(${name})`).all().map(column => column.name));
}

function createVersionOneUsers(database) {
	database.exec(`
		CREATE TABLE users (
			mc_uuid TEXT PRIMARY KEY,
			discord_id TEXT NOT NULL UNIQUE,
			minecraft_name TEXT NOT NULL DEFAULT '',
			verified_at TEXT NOT NULL
		);
	`);
}

function migrateToVersionOne(database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS schema_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		) WITHOUT ROWID;
	`);

	if (!tableExists(database, 'users')) {
		createVersionOneUsers(database);
		return;
	}

	const columns = tableColumns(database, 'users');
	const isCanonical = ['mc_uuid', 'discord_id', 'minecraft_name', 'verified_at']
		.every(column => columns.has(column));
	if (isCanonical) return;

	const isLegacy = ['mc_uuid', 'discord_id', 'first_verified_at', 'last_verified_at']
		.every(column => columns.has(column));
	if (!isLegacy) throw new Error('Unsupported users table schema at user_version 0');

	database.exec('ALTER TABLE users RENAME TO users_legacy_v0;');
	createVersionOneUsers(database);
	database.exec(`
		INSERT INTO users (mc_uuid, discord_id, minecraft_name, verified_at)
		SELECT
			lower(replace(mc_uuid, '-', '')),
			discord_id,
			'',
			COALESCE(first_verified_at, last_verified_at)
		FROM users_legacy_v0;
		DROP TABLE users_legacy_v0;
	`);
}

function migrateToVersionTwo(database) {
	database.exec(`
		CREATE TABLE users_v2 (
			mc_uuid TEXT PRIMARY KEY
				CHECK (
					length(mc_uuid) = 32
					AND mc_uuid = lower(mc_uuid)
					AND mc_uuid NOT GLOB '*[^0-9a-f]*'
				),
			discord_id TEXT NOT NULL UNIQUE
				CHECK (
					length(discord_id) BETWEEN 17 AND 20
					AND discord_id NOT GLOB '*[^0-9]*'
				),
			minecraft_name TEXT NOT NULL DEFAULT '',
			verified_at TEXT NOT NULL
		) WITHOUT ROWID;

		INSERT INTO users_v2 (mc_uuid, discord_id, minecraft_name, verified_at)
		SELECT mc_uuid, discord_id, minecraft_name, verified_at
		FROM users;

		DROP TABLE users;
		ALTER TABLE users_v2 RENAME TO users;
	`);
}

const MIGRATIONS = [migrateToVersionOne, migrateToVersionTwo];

function applyMigrations(database) {
	let version = database.prepare('PRAGMA user_version').get().user_version;
	if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
		throw new Error(`Unsupported database schema version: ${version}`);
	}

	while (version < SCHEMA_VERSION) {
		const nextVersion = version + 1;
		database.exec('BEGIN IMMEDIATE;');
		try {
			MIGRATIONS[version](database);
			database.exec(`PRAGMA user_version = ${nextVersion};`);
			database.exec('COMMIT;');
			version = nextVersion;
		} catch (error) {
			database.exec('ROLLBACK;');
			throw error;
		}
	}
}

function openDatabase(filePath) {
	const database = new DatabaseSync(filePath);
	let closed = false;

	try {
		database.exec('PRAGMA journal_mode = WAL;');
		database.exec('PRAGMA busy_timeout = 5000;');
		database.exec('PRAGMA foreign_keys = ON;');
		applyMigrations(database);
	} catch (error) {
		database.close();
		throw error;
	}

	const selectByUuid = database.prepare(`
		SELECT mc_uuid, discord_id, minecraft_name, verified_at
		FROM users
		WHERE mc_uuid = ?
	`);
	const selectByDiscordId = database.prepare(`
		SELECT mc_uuid, discord_id, minecraft_name, verified_at
		FROM users
		WHERE discord_id = ?
	`);
	const insertUser = database.prepare(`
		INSERT INTO users (mc_uuid, discord_id, minecraft_name, verified_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT DO NOTHING
		RETURNING mc_uuid, discord_id, minecraft_name, verified_at
	`);
	const deleteUser = database.prepare(`
		DELETE FROM users
		WHERE mc_uuid = ? AND discord_id = ?
	`);
	const getMeta = database.prepare('SELECT value FROM schema_meta WHERE key = ?');
	const setMeta = database.prepare(`
		INSERT INTO schema_meta (key, value)
		VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value
	`);

	function assertOpen() {
		if (closed) throw new Error('Database is closed');
	}

	function findByUuid(uuid) {
		assertOpen();
		return toUser(selectByUuid.get(normalizeUuid(uuid)));
	}

	function findByDiscordId(discordId) {
		assertOpen();
		return toUser(selectByDiscordId.get(String(discordId)));
	}

	function addUser({ uuid, discordId, minecraftName, verifiedAt }) {
		assertOpen();
		const normalizedUuid = normalizeUuid(uuid);
		const normalizedDiscordId = String(discordId);
		const name = minecraftName == null ? '' : String(minecraftName);
		const timestamp = verifiedAt instanceof Date ? verifiedAt.toISOString() : String(verifiedAt);
		const user = toUser(insertUser.get(normalizedUuid, normalizedDiscordId, name, timestamp));

		if (user) return { created: true, user };
		return {
			created: false,
			user: toUser(selectByUuid.get(normalizedUuid) || selectByDiscordId.get(normalizedDiscordId)),
		};
	}

	function removeUser(uuid, discordId) {
		assertOpen();
		return deleteUser.run(normalizeUuid(uuid), String(discordId)).changes > 0;
	}

	function migrateLegacyJson(legacyPath) {
		assertOpen();
		const metaKey = 'legacy_json_migration';
		if (getMeta.get(metaKey)) return { migrated: false, imported: 0, skipped: 0 };
		if (!fs.existsSync(legacyPath)) return { migrated: false, imported: 0, skipped: 0 };

		const document = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
		const rows = Array.isArray(document) ? document : document.users;
		if (!Array.isArray(rows)) throw new TypeError('Legacy JSON must contain a users array');

		let imported = 0;
		let skipped = 0;
		database.exec('BEGIN IMMEDIATE;');
		try {
			if (getMeta.get(metaKey)) {
				database.exec('COMMIT;');
				return { migrated: false, imported: 0, skipped: 0 };
			}

			for (let index = 0; index < rows.length; index += 1) {
				database.exec('SAVEPOINT legacy_json_row;');
				try {
					const row = rows[index];
					if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Invalid row');

					const uuid = row['minecraft-uuid'] ?? row.mc_uuid ?? row.uuid;
					const discordId = String(row['discord-acount'] ?? row.discord_id ?? row.discordId ?? '').trim();
					if (!isValidUuid(uuid) || !DISCORD_ID_PATTERN.test(discordId)) {
						throw new TypeError('Invalid UUID or Discord ID');
					}

					const rawDate = row['verify-date'] ?? row.verified_at ?? row.verifiedAt;
					const parsedDate = new Date(rawDate);
					const verifiedAt = Number.isNaN(parsedDate.getTime())
						? new Date().toISOString()
						: parsedDate.toISOString();
					const result = addUser({
						uuid,
						discordId,
						minecraftName: row.minecraft_name ?? row.minecraftName ?? row['minecraft-name'] ?? '',
						verifiedAt,
					});
					if (result.created) imported += 1;
					else skipped += 1;
					database.exec('RELEASE legacy_json_row;');
				} catch {
					database.exec('ROLLBACK TO legacy_json_row;');
					database.exec('RELEASE legacy_json_row;');
					skipped += 1;
				}
			}

			setMeta.run(metaKey, JSON.stringify({ completedAt: new Date().toISOString(), path: legacyPath }));
			database.exec('COMMIT;');
		} catch (error) {
			database.exec('ROLLBACK;');
			throw error;
		}

		return { migrated: true, imported, skipped };
	}

	function close() {
		if (closed) return;
		database.close();
		closed = true;
	}

	return {
		findByUuid,
		findByDiscordId,
		addUser,
		removeUser,
		migrateLegacyJson,
		close,
		schemaVersion: SCHEMA_VERSION,
	};
}

module.exports = { openDatabase, normalizeUuid, isValidUuid };
