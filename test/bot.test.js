'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
	ApplicationCommandOptionType,
	Collection,
	PermissionFlagsBits,
	PermissionsBitField,
} = require('discord.js');

const { commands, isAdmin } = require('../src/bot');

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
