'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { syncMemberRoles } = require('../src/verification');

const ROLE_IDS = Object.freeze({
	verifiedRoleId: '123456789012345680',
	unverifiedRoleId: '123456789012345681',
});

function memberWithRoles(initialRoleIds, { removeError } = {}) {
	const roleIds = new Set(initialRoleIds);
	const calls = [];
	return {
		calls,
		roleIds,
		member: {
			roles: {
				cache: { has: roleId => roleIds.has(roleId) },
				add: async roleId => {
					calls.push(['add', roleId]);
					roleIds.add(roleId);
				},
				remove: async roleId => {
					calls.push(['remove', roleId]);
					if (removeError) throw removeError;
					roleIds.delete(roleId);
				},
			},
		},
	};
}

test('인증된 재가입자는 verified 역할만 갖도록 동기화한다', async () => {
	const state = memberWithRoles([ROLE_IDS.unverifiedRoleId]);
	await syncMemberRoles(state.member, true, ROLE_IDS);

	assert.deepEqual(state.calls, [
		['add', ROLE_IDS.verifiedRoleId],
		['remove', ROLE_IDS.unverifiedRoleId],
	]);
	assert.deepEqual([...state.roleIds], [ROLE_IDS.verifiedRoleId]);
});

test('미등록 재가입자는 unverified 역할만 갖도록 동기화한다', async () => {
	const state = memberWithRoles([ROLE_IDS.verifiedRoleId]);
	await syncMemberRoles(state.member, false, ROLE_IDS);

	assert.deepEqual(state.calls, [
		['remove', ROLE_IDS.verifiedRoleId],
		['add', ROLE_IDS.unverifiedRoleId],
	]);
	assert.deepEqual([...state.roleIds], [ROLE_IDS.unverifiedRoleId]);
});

test('상충 역할 제거 실패를 호출자에게 그대로 전달한다', async () => {
	const removalFailure = new Error('Discord 역할 제거 실패');
	const state = memberWithRoles([ROLE_IDS.unverifiedRoleId], { removeError: removalFailure });

	await assert.rejects(syncMemberRoles(state.member, true, ROLE_IDS), error => error === removalFailure);
	assert.deepEqual(state.calls, [
		['add', ROLE_IDS.verifiedRoleId],
		['remove', ROLE_IDS.unverifiedRoleId],
	]);
});
