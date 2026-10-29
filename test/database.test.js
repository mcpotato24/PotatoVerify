'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { openDatabase } = require('../src/database');

function temporaryDirectory(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'potatoverify-test-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	return directory;
}

test('새 데이터베이스를 SQLite schema v2로 생성한다', t => {
	const databasePath = path.join(temporaryDirectory(t), 'users.sqlite');
	const users = openDatabase(databasePath);
	users.close();

	const database = new DatabaseSync(databasePath, { readOnly: true });
	t.after(() => database.close());
	assert.equal(database.prepare('PRAGMA user_version').get().user_version, 2);
	assert.deepEqual(
		database.prepare('PRAGMA table_info(users)').all().map(column => column.name),
		['mc_uuid', 'discord_id', 'minecraft_name', 'verified_at'],
	);
});

test('user_version 1의 사용자 데이터를 v2로 보존하여 이전한다', t => {
	const databasePath = path.join(temporaryDirectory(t), 'v1.sqlite');
	const v1 = new DatabaseSync(databasePath);
	v1.exec(`
		CREATE TABLE schema_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		) WITHOUT ROWID;
		CREATE TABLE users (
			mc_uuid TEXT PRIMARY KEY,
			discord_id TEXT NOT NULL UNIQUE,
			minecraft_name TEXT NOT NULL DEFAULT '',
			verified_at TEXT NOT NULL
		);
		INSERT INTO users (mc_uuid, discord_id, minecraft_name, verified_at)
		VALUES (
			'0123456789abcdef0123456789abcdef',
			'223456789012345678',
			'PotatoPlayer',
			'2026-01-02T03:04:05.000Z'
		);
		PRAGMA user_version = 1;
	`);
	v1.close();

	const users = openDatabase(databasePath);
	t.after(() => users.close());
	assert.equal(users.schemaVersion, 2);
	assert.deepEqual(users.findByDiscordId('223456789012345678'), {
		mc_uuid: '0123456789abcdef0123456789abcdef',
		discord_id: '223456789012345678',
		minecraft_name: 'PotatoPlayer',
		verified_at: '2026-01-02T03:04:05.000Z',
	});

	const migrated = new DatabaseSync(databasePath, { readOnly: true });
	t.after(() => migrated.close());
	assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 2);
});

test('UUID와 Discord ID 중복 등록을 원자적으로 거부하고 기존 행을 유지한다', t => {
	const databasePath = path.join(temporaryDirectory(t), 'duplicates.sqlite');
	const firstConnection = openDatabase(databasePath);
	const secondConnection = openDatabase(databasePath);
	t.after(() => firstConnection.close());
	t.after(() => secondConnection.close());

	const original = {
		uuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		discordId: '323456789012345678',
		minecraftName: 'OriginalPlayer',
		verifiedAt: '2026-02-03T04:05:06.000Z',
	};
	assert.equal(firstConnection.addUser(original).created, true);

	const duplicateUuid = secondConnection.addUser({
		...original,
		discordId: '423456789012345678',
		minecraftName: 'ReplacementByUuid',
	});
	assert.equal(duplicateUuid.created, false);
	assert.equal(duplicateUuid.user.discord_id, original.discordId);

	const duplicateDiscord = secondConnection.addUser({
		...original,
		uuid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		minecraftName: 'ReplacementByDiscord',
	});
	assert.equal(duplicateDiscord.created, false);
	assert.equal(duplicateDiscord.user.mc_uuid, original.uuid);
	assert.equal(firstConnection.findByUuid('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), undefined);
	assert.deepEqual(firstConnection.findByUuid(original.uuid), {
		mc_uuid: original.uuid,
		discord_id: original.discordId,
		minecraft_name: original.minecraftName,
		verified_at: original.verifiedAt,
	});
});

test('legacy JSON은 유효한 행만 한 번 이전한다', t => {
	const directory = temporaryDirectory(t);
	const legacyPath = path.join(directory, 'user-data.json');
	fs.writeFileSync(legacyPath, JSON.stringify({
		users: [
			{
				'minecraft-uuid': 'cccccccc-cccc-cccc-cccc-cccccccccccc',
				'discord-acount': '523456789012345678',
				'minecraft-name': 'LegacyPlayer',
				'verify-date': '2025-01-02T03:04:05.000Z',
			},
			{ 'minecraft-uuid': 'not-a-uuid', 'discord-acount': '623456789012345678' },
			{
				'minecraft-uuid': 'dddddddd-dddd-dddd-dddd-dddddddddddd',
				'discord-acount': '523456789012345678',
				'verify-date': '2025-02-03T04:05:06.000Z',
			},
		],
	}));

	const users = openDatabase(':memory:');
	t.after(() => users.close());
	assert.deepEqual(users.migrateLegacyJson(legacyPath), {
		migrated: true,
		imported: 1,
		skipped: 2,
	});
	assert.deepEqual(users.findByUuid('cccccccccccccccccccccccccccccccc'), {
		mc_uuid: 'cccccccccccccccccccccccccccccccc',
		discord_id: '523456789012345678',
		minecraft_name: 'LegacyPlayer',
		verified_at: '2025-01-02T03:04:05.000Z',
	});

	fs.writeFileSync(legacyPath, JSON.stringify({
		users: [{
			'minecraft-uuid': 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
			'discord-acount': '723456789012345678',
			'verify-date': '2025-03-04T05:06:07.000Z',
		}],
	}));
	assert.deepEqual(users.migrateLegacyJson(legacyPath), {
		migrated: false,
		imported: 0,
		skipped: 0,
	});
	assert.equal(users.findByUuid('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'), undefined);
});
