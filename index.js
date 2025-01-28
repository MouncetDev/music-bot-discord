require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');

// Initialize the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Command prefix and configuration
const prefix = '*'; // Updated prefix

let connection = null;
let player = null;
let isPlaying = false;
let volume = 0.5;
let currentTrackIndex = 0;
let followUser = null; // Track the user to follow
let pausedPosition = 0; // Track the position where the track was stopped

// List of allowed user IDs
const allowedUsers = new Set([
  '1219384660304592962', // Replace with actual user IDs
]);

// Load music files from the 'music' folder
const musicFolder = path.join(__dirname, 'music');
const playlist = fs.existsSync(musicFolder)
  ? fs.readdirSync(musicFolder).filter(file => file.endsWith('.mp3')).map(file => path.join(musicFolder, file))
  : [];

// Set up Express server
app.get('/', (req, res) => {
  res.send('Server is up.');
});

app.listen(3000, () => {
  console.log('Server started on port 3000');
});

// Set up the Discord client
client.on('ready', () => {
  console.log(`${client.user.tag} is online`);
  client.user.setActivity(`${prefix}help | Music-BOT`, { type: ActivityType.Listening }); // Set bot's activity to listening
});

// Handle incoming messages
client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith(prefix)) return;

  if (!allowedUsers.has(message.author.id)) {
    return message.channel.send('You do not have permission to use this bot.');
  }

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'c') {
    const voiceChannel = message.member.voice.channel;

    if (!voiceChannel) {
      return message.channel.send('You need to be in a voice channel to connect.');
    }

    if (connection) {
      connection.destroy(); // Disconnect from the previous channel
      connection = null;
    }

    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    message.channel.send(`Connected to ${voiceChannel.name}. Use \`${prefix}p\` to start playing.`);
  } else if (command === 'p') {
    if (!connection) {
      return message.channel.send('The bot is not connected to any voice channel. Use `*c` to connect first.');
    }

    if (playlist.length === 0) {
      return message.channel.send('No tracks available in the music folder.');
    }

    playTrack(currentTrackIndex);
  } else if (command === 's') {
    if (!isPlaying) {
      return message.channel.send('The music is not playing!');
    }

    if (player) {
      pausedPosition = player.state.resource.playbackDuration / 1000; // Save the current position in seconds
      player.stop(); // Stops the audio player
      player.removeAllListeners(); // Clears any lingering listeners on the player
    }

    isPlaying = false;
    message.channel.send('Stopped playing!');
  } else if (command === 'rm') {
    if (isPlaying) {
      return message.channel.send('The music is already playing!');
    }

    playTrack(currentTrackIndex, pausedPosition); // Resume from the paused position
  } else if (command === 'n') {
    currentTrackIndex = (currentTrackIndex + 1) % playlist.length; // Go to next track, loop if at the end
    pausedPosition = 0; // Reset the paused position for the next track
    playTrack(currentTrackIndex);
  } else if (command === 'b') {
    currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length; // Go to previous track, loop if at the start
    pausedPosition = 0; // Reset the paused position for the previous track
    playTrack(currentTrackIndex);
  } else if (command === 'v') {
    const volumeArg = parseInt(args[0]);

    if (isNaN(volumeArg) || volumeArg < 1 || volumeArg > 20) {
      return message.channel.send('Please provide a volume between 1 and 20.');
    }

    volume = volumeArg / 20;
    if (player && player.state.resource && player.state.status === AudioPlayerStatus.Playing) {
      player.state.resource.volume.setVolume(volume);
    }

    message.channel.send(`Volume set to ${volumeArg}`);
  } else if (command === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setColor('#6F03FC')
      .setTitle('Music Bot Help')
      .setDescription('Here is a list of commands you can use with this bot:')
      .addFields(
        { name: '**`*c`**', value: 'Connect the bot to your current voice channel.', inline: false },
        { name: '**`*p`**', value: 'Play the first track or resume if stopped.', inline: false },
        { name: '**`*s`**', value: 'Stop playing the current track.', inline: false },
        { name: '**`*rm`**', value: 'Resume playback of the last stopped track.', inline: false },
        { name: '**`*next`**', value: 'Play the next track in the playlist.', inline: false },
        { name: '**`*back`**', value: 'Play the previous track in the playlist.', inline: false },
        { name: '**`*v <volume>`**', value: 'Set the volume. Range: 1 to 20.', inline: false },
        { name: '**`*d`**', value: 'Disconnect the bot from the voice channel.', inline: false },
      )
      .setFooter({ text: 'For more info, contact the bot owner.' });

    message.channel.send({ embeds: [helpEmbed] });
  } else if (command === 'd') {
    if (!connection) {
      return message.channel.send('The bot is not connected to any voice channel.');
    }

    connection.destroy();
    connection = null;
    isPlaying = false;
    currentTrackIndex = 0;
    pausedPosition = 0; // Reset the paused position on disconnect
    message.channel.send('Disconnected from the voice channel.');
  }
});

// Function to play a specific track by index
async function playTrack(index, startTime = 0) {
  if (!connection) {
    console.error('The bot is not connected to any voice channel.');
    return;
  }

  const trackPath = playlist[index];
  try {
    player = createAudioPlayer();
    const resource = createAudioResource(trackPath, { inlineVolume: true, seek: startTime }); // Start from paused position
    resource.volume.setVolume(volume);
    player.play(resource);

    if (connection && !connection.destroyed) {
      connection.subscribe(player);
    } else {
      console.error('Voice connection is not valid.');
    }

    isPlaying = true;

    player.on(AudioPlayerStatus.Idle, () => {
      console.log('Playback finished');
      isPlaying = false;
      currentTrackIndex = (currentTrackIndex + 1) % playlist.length; // Move to the next track
      pausedPosition = 0; // Reset paused position on track end
      playTrack(currentTrackIndex); // Automatically play the next track
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      isPlaying = false;
      connection = null;
    });
  } catch (error) {
    console.error('Error playing the track:', error);
  }
}

client.login(process.env.TOKEN);
