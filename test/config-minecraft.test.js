'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { loadConfig } = require('../src/config');
const { getMinecraftProfile, MinecraftProfileNotFoundError } = require('../src/minecraft');

const VALID_ENV = Object.freeze({
	DISCORD_TOKEN: ' test-token ',
	GUILD_ID: '123456789012345678',
	ADMIN_ROLE_ID: '123456789012345679',
	VERIFIED_ROLE_ID: '123456789012345680',
	UNVERIFIED_ROLE_ID: '123456789012345681',
	DATABASE_PATH: 'data/users.sqlite',
});

test('설정을 검증하고 상대 DB 경로를 기준 디렉터리에서 해석한다', () => {
	const config = loadConfig(VALID_ENV, '/srv/potatoverify');
	assert.deepEqual(config, {
		token: 'test-token',
		guildId: VALID_ENV.GUILD_ID,
		adminRoleId: VALID_ENV.ADMIN_ROLE_ID,
		verifiedRoleId: VALID_ENV.VERIFIED_ROLE_ID,
		unverifiedRoleId: VALID_ENV.UNVERIFIED_ROLE_ID,
		databasePath: path.resolve('/srv/potatoverify', 'data/users.sqlite'),
	});
});

test('필수 설정 누락, 잘못된 ID, 역할 ID 중복을 거부한다', () => {
	assert.throws(() => loadConfig({ ...VALID_ENV, DISCORD_TOKEN: '   ' }), /DISCORD_TOKEN/);
	assert.throws(() => loadConfig({ ...VALID_ENV, GUILD_ID: 'guild-name' }), /GUILD_ID.*17~20자리/);
	assert.throws(
		() => loadConfig({ ...VALID_ENV, VERIFIED_ROLE_ID: VALID_ENV.ADMIN_ROLE_ID }),
		/서로 달라야/,
	);
	assert.throws(() => loadConfig({ ...VALID_ENV, DATABASE_PATH: ' ' }), /DATABASE_PATH/);
});

test('Mojang 프로필 응답을 정규화해 반환한다', async () => {
	let request;
	const profile = await getMinecraftProfile(' Potato Player ', {
		fetchImpl: async (url, options) => {
			request = { url, options };
			return {
				status: 200,
				json: async () => ({
					id: '0123456789ABCDEF0123456789ABCDEF',
					name: 'PotatoPlayer',
				}),
			};
		},
	});

	assert.deepEqual(profile, {
		uuid: '0123456789abcdef0123456789abcdef',
		name: 'PotatoPlayer',
	});
	assert.equal(request.url, 'https://api.mojang.com/users/profiles/minecraft/Potato%20Player');
	assert.ok(request.options.signal instanceof AbortSignal);
});

test('Mojang 404를 사용자 이름이 포함된 전용 오류로 변환한다', async () => {
	await assert.rejects(
		getMinecraftProfile('MissingPlayer', { fetchImpl: async () => ({ status: 404 }) }),
		error => {
			assert.ok(error instanceof MinecraftProfileNotFoundError);
			assert.equal(error.username, 'MissingPlayer');
			return true;
		},
	);
});

test('Mojang 성공 응답의 프로필 payload가 잘못되면 거부한다', async () => {
	await assert.rejects(
		getMinecraftProfile('BrokenPlayer', {
			fetchImpl: async () => ({
				status: 200,
				json: async () => ({ id: 'not-a-uuid', name: 'BrokenPlayer' }),
			}),
		}),
		/유효하지 않은 Minecraft UUID/,
	);
});
