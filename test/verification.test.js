'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { syncMemberRoles } = require('../src/verification');

const ROLE_IDS = Object.freeze({
	verifiedRoleId: '123456789012345680',
	unverifiedRoleId: '123456789012345681',
});

function memberWithRoles(initialRoleIds, { removeErrors = new Map() } = {}) {
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
					if (removeErrors.has(roleId)) throw removeErrors.get(roleId);
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

test('인증 역할 추가 후 미인증 역할 제거가 실패하면 추가를 보상한다', async () => {
	const removalFailure = new Error('Discord 역할 제거 실패');
	const state = memberWithRoles([ROLE_IDS.unverifiedRoleId], {
		removeErrors: new Map([[ROLE_IDS.unverifiedRoleId, removalFailure]]),
	});

	await assert.rejects(syncMemberRoles(state.member, true, ROLE_IDS), error => error === removalFailure);
	assert.deepEqual(state.calls, [
		['add', ROLE_IDS.verifiedRoleId],
		['remove', ROLE_IDS.unverifiedRoleId],
		['remove', ROLE_IDS.verifiedRoleId],
	]);
	assert.deepEqual([...state.roleIds], [ROLE_IDS.unverifiedRoleId]);
});

test('역할 동기화와 보상이 모두 실패하면 두 원인의 AggregateError를 반환한다', async () => {
	const removalFailure = new Error('미인증 역할 제거 실패');
	const compensationFailure = new Error('인증 역할 보상 제거 실패');
	const state = memberWithRoles([ROLE_IDS.unverifiedRoleId], {
		removeErrors: new Map([
			[ROLE_IDS.unverifiedRoleId, removalFailure],
			[ROLE_IDS.verifiedRoleId, compensationFailure],
		]),
	});

	await assert.rejects(syncMemberRoles(state.member, true, ROLE_IDS), error => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [removalFailure, compensationFailure]);
		assert.equal(error.cause, removalFailure);
		assert.match(error.message, /보상 제거에 실패/);
		return true;
	});
	assert.deepEqual(state.calls, [
		['add', ROLE_IDS.verifiedRoleId],
		['remove', ROLE_IDS.unverifiedRoleId],
		['remove', ROLE_IDS.verifiedRoleId],
	]);
});
