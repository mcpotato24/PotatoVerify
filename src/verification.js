'use strict';

function normalizeUuid(uuid) {
	return String(uuid).replaceAll('-', '').toLowerCase();
}

function isValidUuid(uuid) {
	return /^[0-9a-f]{32}$/i.test(normalizeUuid(uuid));
}

function displayDate(value) {
	return new Intl.DateTimeFormat('ko-KR', {
		timeZone: 'Asia/Seoul',
		dateStyle: 'medium',
		timeStyle: 'medium',
	}).format(new Date(value));
}

function userValue(user, ...names) {
	for (const name of names) {
		if (user?.[name] !== undefined) return user[name];
	}
	return undefined;
}

function duplicateMessage(existing, adminRoleId) {
	const verifiedAt = userValue(existing, 'verifiedAt', 'firstVerifiedAt', 'first_verified_at');
	const suffix = verifiedAt ? ` (최초 인증: ${displayDate(verifiedAt)})` : '';
	return `이미 인증된 계정입니다. <@&${adminRoleId}> 관리자에게 문의해 주세요.${suffix}`;
}

async function setRole(member, roleId, shouldHaveRole) {
	const hasRole = member.roles.cache.has(roleId);
	if (shouldHaveRole && !hasRole) await member.roles.add(roleId);
	if (!shouldHaveRole && hasRole) await member.roles.remove(roleId);
}

async function syncMemberRoles(member, isVerified, { verifiedRoleId, unverifiedRoleId }) {
	await setRole(member, verifiedRoleId, isVerified);
	await setRole(member, unverifiedRoleId, !isVerified);
}

async function registerVerification({
	users,
	getMinecraftProfile,
	minecraftName,
	discordId,
	member,
	verifiedRoleId,
	unverifiedRoleId,
	verifiedAt = new Date().toISOString(),
}) {
	const existingDiscord = users.findByDiscordId(discordId);
	if (existingDiscord) return { created: false, user: existingDiscord };

	const profile = await getMinecraftProfile(minecraftName);
	const uuid = normalizeUuid(profile.uuid);
	const existingUuid = users.findByUuid(uuid);
	if (existingUuid) return { created: false, user: existingUuid, profile };

	const user = {
		uuid,
		discordId,
		minecraftName: profile.name,
		verifiedAt,
	};
	const stored = users.addUser(user);
	if (!stored.created) return { created: false, user: stored.user, profile };

	if (member) {
		try {
			await syncMemberRoles(member, true, { verifiedRoleId, unverifiedRoleId });
		} catch (error) {
			try {
				users.removeUser(uuid, discordId);
			} catch (rollbackError) {
				error.rollbackError = rollbackError;
			}
			throw error;
		}
	}

	return { created: true, user: stored.user, profile };
}

module.exports = {
	displayDate,
	duplicateMessage,
	isValidUuid,
	normalizeUuid,
	registerVerification,
	syncMemberRoles,
	userValue,
};
