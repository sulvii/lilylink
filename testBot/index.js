/**
 * Example Discord.js bot using LilyLink
 *
 * @requires dotenv - For loading environment variables
 * @requires discord.js - Discord bot framework (v14.22+)
 * @requires LilyLink - Lavalink client library
 */

require("dotenv").config();
const {
	Client,
	GatewayIntentBits,
	EmbedBuilder,
	ActivityType,
	PermissionFlagsBits,
} = require("discord.js");
const {
	LilyManager,
	Source,
	LoadType,
	PlayerLoop,
	WeakMapAdapter,
} = require("../dist");

const config = {
	prefix: "!",
	nodes: [
		{
			host: "82.79.179.26",
			port: Number(process.env.LAVALINK_PORT ?? 2333),
			password: "fuckyouidfk",
			secure: false,
			identifier: "main",
		},
	],
	options: {
		queueStartIndex: 1,
		cache: {
			adapter: new WeakMapAdapter({
				revalidate: true,
				ttl: 1000 * 60 * 5, // 5 minutes
			}),
		},
	},
};

/**
 * Formats a duration in milliseconds as HH:MM:SS or MM:SS
 * @param {number} ms
 * @returns {string}
 */
const formatDuration = (ms = 0) => {
	const seconds = Math.floor((ms / 1000) % 60);
	const minutes = Math.floor((ms / (1000 * 60)) % 60);
	const hours = Math.floor(ms / (1000 * 60 * 60));

	return `${hours ? `${hours}:` : ""}${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

/**
 * Makes sure the user is in a voice channel and the bot can join and speak there
 * @param {import("discord.js").Message<true>} message
 * @throws {Error}
 */
const checkPermissions = (message) => {
	const voiceChannel = message.member.voice.channel;

	if (!voiceChannel) {
		throw new Error("You must be in a voice channel to use this command!");
	}

	const permissions = voiceChannel.permissionsFor(message.guild.members.me);
	if (
		!permissions?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])
	) {
		throw new Error(
			"I need permissions to join and speak in your voice channel!",
		);
	}
};

/**
 * Gets the player for a guild or throws
 * @param {import("discord.js").Message<true>} message
 */
const requirePlayer = (message) => {
	const player = manager.players.get(message.guild.id);
	if (!player) {
		throw new Error("No music is playing!");
	}
	return player;
};

/**
 * Sends a message to a channel by id, if it can be sent to
 * @param {string} channelId
 * @param {string | import("discord.js").MessageCreateOptions} content
 */
const sendTo = (channelId, content) => {
	const channel = client.channels.cache.get(channelId);
	if (channel?.isSendable()) {
		return channel.send(content);
	}
};

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildVoiceStates,
	],
});

const manager = new LilyManager({
	nodes: config.nodes,
	sendPayload: async (guildId, payload) => {
		const guild = client.guilds.cache.get(guildId);
		if (guild) {
			guild.shard.send(JSON.parse(payload));
		}
	},
	options: config.options,
});

client.manager = manager;

client.once("clientReady", async () => {
	await client.manager.init(client.user.id);
	console.log(`Logged in as ${client.user.tag}!`);
	client.user.setActivity("!help for commands", {
		type: ActivityType.Listening,
	});
});

client.on("raw", (packet) => {
	client.manager.packetUpdate(packet).catch((error) => {
		console.error("Voice packet error:", error);
	});
});

manager.on("nodeReady", (node) => {
	console.log(`Node ${node.identifier} ready!`);
});

manager.on("nodeConnected", (node) => {
	console.log(`Node ${node.identifier} connected!`);
});

manager.on("nodeError", (node, error) => {
	console.error(`Node ${node.identifier} error:`, error);
});

manager.on("trackStart", (player, track) => {
	const embed = new EmbedBuilder()
		.setColor("#0099ff")
		.setTitle("Now Playing")
		.setDescription(`[${track.title}](${track.url})`)
		.addFields(
			{
				name: "Duration",
				value: formatDuration(track.duration),
				inline: true,
			},
			{
				name: "Requested by",
				value: String(track.requestedBy ?? "Unknown"),
				inline: true,
			},
		);

	sendTo(player.textChannel, { embeds: [embed] });
});

manager.on("trackException", (player, _track, error) => {
	sendTo(player.textChannel, `❌ Error: ${error.message ?? "Track failed"}`);
});

manager.on("queueEnd", async (player) => {
	await sendTo(player.textChannel, "Queue ended! Use !play to add more songs.");
	await player.destroy();
});

manager.on("cacheInitialized", () => {
	console.log("Cache initialized!");
});

manager.on("cacheSet", ([key]) => {
	console.log(`Cache set: ${key}`);
});

/**
 * Command handlers
 * @type {Record<string, (message: import("discord.js").Message<true>, args: string[]) => unknown>}
 */
const commands = {
	async play(message, args) {
		try {
			checkPermissions(message);

			if (!args.length) {
				throw new Error("Please provide a song to play!");
			}

			const player = manager.createPlayer({
				guildId: message.guild.id,
				voiceChannel: message.member.voice.channelId,
				textChannel: message.channel.id,
			});

			if (!player) {
				throw new Error("Could not create a player!");
			}

			if (!player.connected) {
				await player.connect({ setDeaf: true });
			}

			const result = await manager.search({
				query: args.join(" "),
				source: Source.YOUTUBE,
				requester: message.author.globalName ?? message.author.username,
			});

			if (result.loadType === LoadType.Error) {
				throw new Error(result.exception?.message ?? "Failed to load tracks!");
			}

			if (!result.tracks?.length) {
				throw new Error("No results found!");
			}

			const isPlaylist = result.loadType === LoadType.Playlist;
			const tracks = isPlaylist ? result.tracks : [result.tracks[0]];
			const label = isPlaylist ? result.playlistInfo?.name : tracks[0].title;

			for (const track of tracks) {
				player.queue.add(track);
			}

			if (player.playing) {
				await message.reply(`Added to queue: ${label}`);
			} else {
				await player.play();
				await message.reply(`Playing: ${label}`);
			}
		} catch (error) {
			await message.reply(`❌ Error: ${error.message}`);
		}
	},

	async skip(message) {
		try {
			checkPermissions(message);
			const player = requirePlayer(message);

			if (!(await player.skip())) {
				throw new Error("There's nothing in the queue to skip to!");
			}

			await message.reply("⏭️ Skipped to the next song!");
		} catch (error) {
			await message.reply(`❌ Error: ${error.message}`);
		}
	},

	async shuffle(message) {
		try {
			checkPermissions(message);
			const player = requirePlayer(message);

			if (!player.shuffle()) {
				throw new Error("I need at least 2 songs in the queue to shuffle!");
			}

			await message.reply("🔀 Shuffled the queue!");
		} catch (error) {
			await message.reply(`❌ Error: ${error.message}`);
		}
	},

	async stop(message) {
		try {
			checkPermissions(message);
			const player = requirePlayer(message);

			await player.destroy();
			await message.reply("⏹️ Stopped the music and cleared the queue!");
		} catch (error) {
			await message.reply(`❌ Error: ${error.message}`);
		}
	},

	async pause(message) {
		try {
			checkPermissions(message);
			const player = requirePlayer(message);

			if (player.paused) {
				return await message.reply("⏸️ Already paused!");
			}

			await player.pause();
			await message.reply("⏸️ Paused!");
		} catch (error) {
			await message.reply(`❌ Error: ${error.message}`);
		}
	},

	async resume(message) {
		try {
			checkPermissions(message);
			const player = requirePlayer(message);

			if (!player.paused) {
				return await message.reply("▶️ Already playing!");
			}

			await player.resume();
			await message.reply("▶️ Resumed!");
		} catch (error) {
			await message.reply(`❌ Error: ${error.message}`);
		}
	},

	async loop(message, args) {
		try {
			checkPermissions(message);
			const player = requirePlayer(message);

			const mode = args[0]?.toLowerCase();
			if (mode !== "track" && mode !== "queue") {
				throw new Error('Please specify either "track" or "queue" to loop!');
			}

			const target = mode === "track" ? PlayerLoop.TRACK : PlayerLoop.QUEUE;
			const enabling = player.loop !== target;

			player.setLoop(enabling ? target : PlayerLoop.OFF);

			const icon = mode === "track" ? "🔂" : "🔁";
			await message.reply(
				enabling ? `${icon} ${mode} loop enabled!` : `➡️ ${mode} loop disabled!`,
			);
		} catch (error) {
			await message.reply(`❌ Error: ${error.message}`);
		}
	},

	async queue(message) {
		try {
			const player = requirePlayer(message);

			const embed = new EmbedBuilder()
				.setTitle("Music Queue")
				.setColor("#0099ff");

			if (player.current) {
				embed.addFields({
					name: "Now Playing",
					value: `[${player.current.title}](${player.current.url}) [${formatDuration(player.current.duration)}]`,
				});
			}

			if (player.queue.size) {
				const tracks = player.queue
					.map(
						(track, index) =>
							`${index}. [${track.title}](${track.url}) [${formatDuration(track.duration)}]`,
					)
					.join("\n");

				embed.addFields({
					name: "Up Next",
					value: tracks.slice(0, 1024),
				});
			}

			await message.reply({ embeds: [embed] });
		} catch (error) {
			await message.reply(`❌ Error: ${error.message}`);
		}
	},

	async help(message) {
		const embed = new EmbedBuilder()
			.setTitle("Bot Commands")
			.setColor("#0099ff")
			.addFields([
				{ name: "!play <song>", value: "Play a song or add it to queue" },
				{ name: "!skip", value: "Skip the current song" },
				{ name: "!stop", value: "Stop playing and clear the queue" },
				{ name: "!pause", value: "Pause the current song" },
				{ name: "!resume", value: "Resume the current song" },
				{ name: "!shuffle", value: "Shuffle the queue" },
				{ name: "!queue", value: "Show the current queue" },
				{ name: "!loop track/queue", value: "Toggle track or queue loop" },
			]);

		await message.reply({ embeds: [embed] });
	},
};

client.on("messageCreate", async (message) => {
	if (
		message.author.bot ||
		!message.inGuild() ||
		!message.content.startsWith(config.prefix)
	) {
		return;
	}

	const [rawName, ...args] = message.content
		.slice(config.prefix.length)
		.trim()
		.split(/\s+/);
	const commandName = rawName.toLowerCase();

	if (!Object.hasOwn(commands, commandName)) {
		return;
	}

	try {
		await commands[commandName](message, args);
	} catch (error) {
		console.error("Command error:", error);
		await message.reply("An error occurred while executing the command.");
	}
});

process.on("unhandledRejection", (error) => {
	console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
	console.error("Uncaught exception:", error);
});

client.login(process.env.DISCORD_TOKEN);
