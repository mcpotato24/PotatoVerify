const PROFILE_ENDPOINT = 'https://api.mojang.com/users/profiles/minecraft';
const UUID_PATTERN = /^[0-9a-f]{32}$/i;

class MinecraftProfileNotFoundError extends Error {
	constructor(username) {
		super(`Minecraft 프로필을 찾을 수 없습니다: ${username}`);
		this.name = 'MinecraftProfileNotFoundError';
		this.username = username;
	}
}

async function getMinecraftProfile(username, { fetchImpl = globalThis.fetch } = {}) {
	if (typeof username !== 'string' || username.trim() === '') {
		throw new TypeError('username은 비어 있지 않은 문자열이어야 합니다.');
	}
	if (typeof fetchImpl !== 'function') {
		throw new TypeError('fetchImpl은 함수여야 합니다.');
	}

	const normalizedUsername = username.trim();
	const response = await fetchImpl(
		`${PROFILE_ENDPOINT}/${encodeURIComponent(normalizedUsername)}`,
		{ signal: AbortSignal.timeout(10_000) },
	);

	if (response === null || typeof response !== 'object' || !Number.isInteger(response.status)) {
		throw new Error('Mojang API가 유효하지 않은 응답을 반환했습니다.');
	}
	if (response.status === 404) {
		throw new MinecraftProfileNotFoundError(normalizedUsername);
	}
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Mojang API 요청에 실패했습니다. (HTTP ${response.status})`);
	}
	if (typeof response.json !== 'function') {
		throw new Error('Mojang API 응답 본문을 읽을 수 없습니다.');
	}

	let body;
	try {
		body = await response.json();
	} catch (error) {
		throw new Error('Mojang API가 유효한 JSON 본문을 반환하지 않았습니다.', { cause: error });
	}

	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		throw new Error('Mojang API가 유효하지 않은 프로필 본문을 반환했습니다.');
	}
	if (typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) {
		throw new Error('Mojang API가 유효하지 않은 Minecraft UUID를 반환했습니다.');
	}
	if (typeof body.name !== 'string' || body.name.trim() === '') {
		throw new Error('Mojang API가 유효하지 않은 Minecraft 사용자 이름을 반환했습니다.');
	}

	return { uuid: body.id.toLowerCase(), name: body.name };
}

module.exports = { getMinecraftProfile, MinecraftProfileNotFoundError };
