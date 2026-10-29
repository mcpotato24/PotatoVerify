const path = require('node:path');

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function requiredString(env, name) {
	const value = env[name];
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${name} 환경변수가 설정되지 않았습니다. .env.example을 참고하세요.`);
	}
	return value.trim();
}

function snowflake(env, name) {
	const value = requiredString(env, name);
	if (!SNOWFLAKE_PATTERN.test(value)) {
		throw new Error(`${name} 환경변수는 17~20자리 숫자 Discord ID여야 합니다.`);
	}
	return value;
}

function loadConfig(env = process.env, baseDir = process.cwd()) {
	if (env === null || typeof env !== 'object') {
		throw new TypeError('env는 환경변수 객체여야 합니다.');
	}
	if (typeof baseDir !== 'string' || baseDir.trim() === '') {
		throw new TypeError('baseDir는 비어 있지 않은 경로 문자열이어야 합니다.');
	}

	const token = requiredString(env, 'DISCORD_TOKEN');
	const guildId = snowflake(env, 'GUILD_ID');
	const adminRoleId = snowflake(env, 'ADMIN_ROLE_ID');
	const verifiedRoleId = snowflake(env, 'VERIFIED_ROLE_ID');
	const unverifiedRoleId = snowflake(env, 'UNVERIFIED_ROLE_ID');
	const roleIds = [adminRoleId, verifiedRoleId, unverifiedRoleId];

	if (new Set(roleIds).size !== roleIds.length) {
		throw new Error('ADMIN_ROLE_ID, VERIFIED_ROLE_ID, UNVERIFIED_ROLE_ID는 서로 달라야 합니다.');
	}

	let configuredDatabasePath = env.DATABASE_PATH;
	if (configuredDatabasePath === undefined) configuredDatabasePath = 'user-data.sqlite';
	if (typeof configuredDatabasePath !== 'string' || configuredDatabasePath.trim() === '') {
		throw new Error('DATABASE_PATH 환경변수는 비어 있지 않은 경로여야 합니다.');
	}
	configuredDatabasePath = configuredDatabasePath.trim();
	if (configuredDatabasePath.includes('\0')) {
		throw new Error('DATABASE_PATH 환경변수에 NUL 문자를 사용할 수 없습니다.');
	}

	const databasePath = path.resolve(baseDir, configuredDatabasePath);

	return {
		token,
		guildId,
		adminRoleId,
		verifiedRoleId,
		unverifiedRoleId,
		databasePath,
	};
}

module.exports = { loadConfig };
