'use strict';

const {
	ActivityType,
	Client,
	Events,
	GatewayIntentBits,
	PermissionFlagsBits,
	REST,
	RESTJSONErrorCodes,
	Routes,
	SlashCommandBuilder,
} = require('discord.js');
const { MinecraftProfileNotFoundError } = require('./minecraft');
const {
	displayDate,
	duplicateMessage,
	isValidUuid,
	normalizeUuid,
	registerVerification,
	syncMemberRoles,
	userValue,
} = require('./verification');

const commands = [
	new SlashCommandBuilder()
		.setName('인증')
		.setDescription('Minecraft 계정으로 서버 인증을 진행합니다.')
		.addStringOption(option => option.setName('닉네임').setDescription('Minecraft 닉네임').setRequired(true)),
	new SlashCommandBuilder()
		.setName('수동등록')
		.setDescription('관리자가 사용자의 Minecraft 계정을 수동 등록합니다.')
		.addUserOption(option => option.setName('사용자').setDescription('등록할 Discord 사용자').setRequired(true))
		.addStringOption(option => option.setName('닉네임').setDescription('Minecraft 닉네임').setRequired(true)),
	new SlashCommandBuilder()
		.setName('인증조회')
		.setDescription('관리자가 사용자의 인증 정보를 조회합니다.')
		.addUserOption(option => option.setName('사용자').setDescription('조회할 Discord 사용자'))
		.addStringOption(option => option.setName('uuid').setDescription('조회할 Minecraft UUID')),
	new SlashCommandBuilder()
		.setName('전송')
		.setDescription('관리자가 현재 채널에 봇 메시지를 전송합니다.')
		.addStringOption(option => option.setName('내용').setDescription('전송할 메시지').setRequired(true)),
].map(command => command.toJSON());

function isAdmin(interaction, adminRoleId) {
	return Boolean(
		interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
		|| interaction.member?.roles?.cache?.has(adminRoleId),
	);
}

function writeLog(logger, level, message, error) {
	const method = typeof logger?.[level] === 'function'
		? logger[level].bind(logger)
		: (typeof logger?.log === 'function' ? logger.log.bind(logger) : console[level].bind(console));
	if (error) method(message, error);
	else method(message);
}

function createCommandHandlers({ config, users, getMinecraftProfile, logger }) {
	const registrationOptions = {
		users,
		getMinecraftProfile,
		verifiedRoleId: config.verifiedRoleId,
		unverifiedRoleId: config.unverifiedRoleId,
	};

	return new Map([
		['인증', async interaction => {
			await interaction.deferReply({ ephemeral: true });
			const result = await registerVerification({
				...registrationOptions,
				minecraftName: interaction.options.getString('닉네임', true),
				discordId: interaction.user.id,
				member: interaction.member,
			});
			if (!result.created) {
				return interaction.editReply(duplicateMessage(result.user, config.adminRoleId));
			}
			writeLog(logger, 'info', `${interaction.user.tag} 인증 완료: ${result.profile.name} (${result.profile.uuid})`);
			return interaction.editReply(`✅ 인증 완료: **${result.profile.name}**`);
		}],
		['수동등록', async interaction => {
			await interaction.deferReply({ ephemeral: true });
			const target = interaction.options.getUser('사용자', true);
			let member;
			try {
				member = await interaction.guild.members.fetch(target.id);
			} catch (error) {
				if (error?.code !== RESTJSONErrorCodes.UnknownMember) throw error;
				member = null;
			}
			const result = await registerVerification({
				...registrationOptions,
				minecraftName: interaction.options.getString('닉네임', true),
				discordId: target.id,
				member,
			});
			if (!result.created) {
				return interaction.editReply(duplicateMessage(result.user, config.adminRoleId));
			}
			writeLog(logger, 'info', `${interaction.user.tag}님이 ${target.tag} 수동 등록: ${result.profile.name} (${result.profile.uuid})`);
			return interaction.editReply(`✅ ${target}님을 **${result.profile.name}** 계정으로 등록했습니다.`);
		}],
		['인증조회', async interaction => {
			const target = interaction.options.getUser('사용자');
			const uuidInput = interaction.options.getString('uuid');
			if (!target && !uuidInput) {
				return interaction.reply({ content: '사용자 또는 UUID 중 하나를 입력해 주세요.', ephemeral: true });
			}

			const user = target
				? users.findByDiscordId(target.id)
				: (isValidUuid(uuidInput) ? users.findByUuid(normalizeUuid(uuidInput)) : null);
			if (!user) {
				return interaction.reply({ content: '인증 정보를 찾을 수 없습니다.', ephemeral: true });
			}

			const discordId = userValue(user, 'discord_id', 'discordId');
			const uuid = userValue(user, 'mc_uuid', 'mcUuid', 'uuid');
			const verifiedAt = userValue(user, 'first_verified_at', 'firstVerifiedAt', 'verifiedAt');
			const lastVerifiedAt = userValue(user, 'last_verified_at', 'lastVerifiedAt') ?? verifiedAt;
			return interaction.reply({
				content: `Discord: <@${discordId}>\nMinecraft UUID: \`${uuid}\`\n최초 인증: ${displayDate(verifiedAt)}\n마지막 인증: ${displayDate(lastVerifiedAt)}`,
				ephemeral: true,
			});
		}],
		['전송', async interaction => {
			await interaction.channel.send(interaction.options.getString('내용', true));
			return interaction.reply({ content: '메시지를 전송했습니다.', ephemeral: true });
		}],
	]);
}

function createBot({ config, users, getMinecraftProfile, logger = console }) {
	const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
	const commandHandlers = createCommandHandlers({ config, users, getMinecraftProfile, logger });

	client.once(Events.ClientReady, async readyClient => {
		try {
			const rest = new REST({ version: '10' }).setToken(config.token);
			await rest.put(Routes.applicationGuildCommands(readyClient.application.id, config.guildId), {
				body: commands,
			});
			readyClient.user.setActivity('potato24.kr', { type: ActivityType.Competing });
			writeLog(logger, 'info', `[✔] ${readyClient.user.tag} 시작 및 슬래시 명령어 등록 완료`);
		} catch (error) {
			writeLog(logger, 'error', '슬래시 명령어 등록 실패:', error);
		}
	});

	client.on(Events.GuildMemberAdd, async member => {
		if (member.guild.id !== config.guildId) return;
		try {
			const verified = Boolean(users.findByDiscordId(member.id));
			await syncMemberRoles(member, verified, config);
			writeLog(
				logger,
				'info',
				`[✔] ${member.user.tag}님에게 ${verified ? '인증' : '미인증'} 역할을 동기화했습니다.`,
			);
		} catch (error) {
			writeLog(logger, 'error', `${member.user.tag} 역할 동기화 실패:`, error);
		}
	});

	client.on(Events.InteractionCreate, async interaction => {
		if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) return;
		const handler = commandHandlers.get(interaction.commandName);
		if (!handler) return;

		try {
			if (interaction.commandName !== '인증' && !isAdmin(interaction, config.adminRoleId)) {
				await interaction.reply({ content: '이 명령어는 관리자만 사용할 수 있습니다.', ephemeral: true });
				return;
			}
			await handler(interaction);
		} catch (error) {
			const message = error instanceof MinecraftProfileNotFoundError
				? '올바른 Minecraft 닉네임을 입력해 주세요.'
				: '처리 중 오류가 발생했습니다. 관리자에게 문의해 주세요.';
			writeLog(logger, 'error', `${interaction.commandName} 처리 실패:`, error);
			try {
				if (interaction.deferred || interaction.replied) await interaction.editReply(message);
				else await interaction.reply({ content: message, ephemeral: true });
			} catch (responseError) {
				writeLog(logger, 'error', `${interaction.commandName} 오류 응답 실패:`, responseError);
			}
		}
	});

	client.commandHandlers = commandHandlers;
	return client;
}

module.exports = {
	commands,
	createBot,
	createCommandHandlers,
	isAdmin,
};
