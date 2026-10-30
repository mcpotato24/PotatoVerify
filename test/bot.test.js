'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
	ApplicationCommandOptionType,
	Collection,
	PermissionFlagsBits,
	PermissionsBitField,
	RESTJSONErrorCodes,
} = require('discord.js');

const { commands, createCommandHandlers, isAdmin } = require('../src/bot');
const { displayDate } = require('../src/verification');

const ADMIN_ROLE_ID = '123456789012345679';

function optionContract(command) {
	return command.options.map(({ name, type, required = false }) => ({ name, type, required }));
}

test('Discord 소비자가 사용할 슬래시 명령과 필수 옵션을 정의한다', () => {
	const byName = new Map(commands.map(command => [command.name, command]));
	assert.deepEqual([...byName.keys()], ['인증', '수동등록', '인증조회', '전송']);
	assert.deepEqual(optionContract(byName.get('인증')), [
		{ name: '닉네임', type: ApplicationCommandOptionType.String, required: true },
	]);
	assert.deepEqual(optionContract(byName.get('수동등록')), [
		{ name: '사용자', type: ApplicationCommandOptionType.User, required: true },
		{ name: '닉네임', type: ApplicationCommandOptionType.String, required: true },
	]);
	assert.deepEqual(optionContract(byName.get('인증조회')), [
		{ name: '사용자', type: ApplicationCommandOptionType.User, required: false },
		{ name: 'uuid', type: ApplicationCommandOptionType.String, required: false },
	]);
	assert.deepEqual(optionContract(byName.get('전송')), [
		{ name: '내용', type: ApplicationCommandOptionType.String, required: true },
	]);
	for (const command of commands) {
		assert.equal(command.type, 1);
		assert.ok(command.description.length > 0);
	}
});

test('Discord 관리자 권한 또는 설정된 관리자 역할로 관리자 여부를 판단한다', () => {
	const interaction = (permissions, roleIds = []) => ({
		memberPermissions: new PermissionsBitField(permissions),
		member: {
			roles: {
				cache: new Collection(roleIds.map(roleId => [roleId, { id: roleId }])),
			},
		},
	});

	assert.equal(isAdmin(interaction(PermissionFlagsBits.Administrator), ADMIN_ROLE_ID), true);
	assert.equal(isAdmin(interaction(0n, [ADMIN_ROLE_ID]), ADMIN_ROLE_ID), true);
	assert.equal(isAdmin(interaction(0n, ['923456789012345678']), ADMIN_ROLE_ID), false);
	assert.equal(isAdmin({ memberPermissions: null, member: null }, ADMIN_ROLE_ID), false);
});

function handlerDependencies(overrides = {}) {
	return {
		config: {
			adminRoleId: ADMIN_ROLE_ID,
			verifiedRoleId: '123456789012345680',
			unverifiedRoleId: '123456789012345681',
		},
		users: {
			findByDiscordId: () => undefined,
			findByUuid: () => undefined,
			addUser: user => ({ created: true, user }),
			removeUser: () => true,
		},
		getMinecraftProfile: async () => ({
			uuid: '0123456789abcdef0123456789abcdef',
			name: 'PotatoPlayer',
		}),
		logger: { info() {}, error() {} },
		...overrides,
	};
}

function manualRegistrationInteraction(fetchMember) {
	const replies = [];
	return {
		replies,
		interaction: {
			user: { tag: 'Admin#0001' },
			guild: { members: { fetch: fetchMember } },
			options: {
				getUser: () => ({ id: '223456789012345678', tag: 'Target#0001', toString: () => '<@223456789012345678>' }),
				getString: () => 'PotatoPlayer',
			},
			deferReply: async () => {},
			editReply: async value => replies.push(value),
		},
	};
}

test('수동 등록은 Discord code 10007일 때만 서버 미가입자로 처리한다', async () => {
	const notMember = new Error('Unknown Member');
	notMember.code = RESTJSONErrorCodes.UnknownMember;
	const state = manualRegistrationInteraction(async () => { throw notMember; });
	const handler = createCommandHandlers(handlerDependencies()).get('수동등록');

	await handler(state.interaction);

	assert.deepEqual(state.replies, ['✅ <@223456789012345678>님을 **PotatoPlayer** 계정으로 등록했습니다.']);
});

test('수동 등록의 일시적 member fetch 오류는 호출자에게 전파한다', async () => {
	const transientFailure = new Error('Discord gateway timeout');
	transientFailure.code = 50_013;
	const state = manualRegistrationInteraction(async () => { throw transientFailure; });
	let profileRequested = false;
	const handler = createCommandHandlers(handlerDependencies({
		getMinecraftProfile: async () => {
			profileRequested = true;
			throw new Error('호출되지 않아야 함');
		},
	})).get('수동등록');

	await assert.rejects(handler(state.interaction), error => error === transientFailure);
	assert.equal(profileRequested, false);
	assert.deepEqual(state.replies, []);
});

test('인증 조회에 최초와 마지막 인증 시각을 각각 표시한다', async () => {
	const firstVerifiedAt = '2025-01-02T03:04:05.000Z';
	const lastVerifiedAt = '2026-02-03T04:05:06.000Z';
	const user = {
		mc_uuid: '0123456789abcdef0123456789abcdef',
		discord_id: '223456789012345678',
		minecraft_name: 'PotatoPlayer',
		first_verified_at: firstVerifiedAt,
		last_verified_at: lastVerifiedAt,
	};
	let reply;
	const handler = createCommandHandlers(handlerDependencies({
		users: {
			findByDiscordId: () => user,
			findByUuid: () => undefined,
		},
	})).get('인증조회');
	const interaction = {
		options: {
			getUser: () => ({ id: user.discord_id }),
			getString: () => null,
		},
		reply: async value => { reply = value; },
	};

	await handler(interaction);

	assert.deepEqual(reply, {
		content: `Discord: <@${user.discord_id}>\nMinecraft UUID: \`${user.mc_uuid}\`\n최초 인증: ${displayDate(firstVerifiedAt)}\n마지막 인증: ${displayDate(lastVerifiedAt)}`,
		ephemeral: true,
	});
});
