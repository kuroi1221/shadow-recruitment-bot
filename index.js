require('dotenv').config();

const fs = require('fs');

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// =====================================
// CONFIG
// =====================================

// Auto leaderboard update interval
const UPDATE_INTERVAL =
    6 * 60 * 60 * 1000;

// Verification time
const THREE_DAYS =
    3 * 24 * 60 * 60 * 1000;

// =====================================

const inviteCache = new Map();

// =====================================
// DATABASE
// =====================================

let data = {
    recruiters: {},
    pending: {},
    verified: {},
    left: {}
};

if (fs.existsSync('./recruits.json')) {

    data = JSON.parse(
        fs.readFileSync('./recruits.json')
    );

}

// =====================================
// LEADERBOARD DATA
// =====================================

let leaderboardData = {};

if (fs.existsSync('./leaderboard.json')) {

    leaderboardData = JSON.parse(
        fs.readFileSync('./leaderboard.json')
    );

}

// =====================================
// SETTINGS
// =====================================

let settings = {};

if (fs.existsSync('./settings.json')) {

    settings = JSON.parse(
        fs.readFileSync('./settings.json')
    );

}

// =====================================
// SAVE DATABASE
// =====================================

function saveData() {

    fs.writeFileSync(
        './recruits.json',
        JSON.stringify(data, null, 2)
    );

}

function saveSettings() {

    fs.writeFileSync(
        './settings.json',
        JSON.stringify(settings, null, 2)
    );

}
// =====================================
// READY
// =====================================

client.once('ready', async () => {

    console.log(
        `Logged in as ${client.user.tag}`
    );

    for (const guild of client.guilds.cache.values()) {

        const invites =
            await guild.invites.fetch();

        const codeUses = new Map();

        invites.forEach(invite => {

            codeUses.set(
                invite.code,
                invite.uses
            );

        });

        inviteCache.set(
            guild.id,
            codeUses
        );

    }

    console.log(
        'Invite cache loaded'
    );

    startLeaderboardUpdates();

    setInterval(
    verifyRecruits,
    60 * 60 * 1000
);

});

// =====================================
// MEMBER JOIN
// =====================================

client.on('guildMemberAdd', async member => {

    const guild = member.guild;

    const newInvites =
        await guild.invites.fetch();

    const oldInvites =
        inviteCache.get(guild.id);

    const usedInvite =
        newInvites.find(invite => {

            const oldUses =
                oldInvites.get(invite.code) || 0;

            return invite.uses > oldUses;

        });

    // Update cache
    const newCache = new Map();

    newInvites.forEach(invite => {

        newCache.set(
            invite.code,
            invite.uses
        );

    });

    inviteCache.set(
        guild.id,
        newCache
    );

    if (!usedInvite) return;

    // =====================================
    // ANTI FAKE CHECK
    // =====================================

    const accountAge =
        Date.now() -
        member.user.createdTimestamp;

    const sevenDays =
        7 * 24 * 60 * 60 * 1000;

    if (accountAge < sevenDays) {

        console.log(
            `${member.user.tag} ignored (account too new)`
        );

        return;

    }

    const recruiterId =
        usedInvite.inviter.id;

    // Create recruiter
    if (!data.recruiters[recruiterId]) {

        data.recruiters[recruiterId] = {

            verified: 0,
            pending: 0,
            left: 0

        };

    }

    // Pending recruit
    data.recruiters[recruiterId]
        .pending++;

    // Save pending recruit
    data.pending[member.user.id] = {

        recruiterId: recruiterId,
        joinedAt: Date.now()

    };

    saveData();

await updateLeaderboard(guild);

console.log(
    `${member.user.tag} joined using ${usedInvite.code}`
);

});

// =====================================
// AUTO VERIFY
// =====================================

async function verifyRecruits() {

    const now = Date.now();

    for (const userId in data.pending) {

        const pendingData =
            data.pending[userId];

        if (
            now - pendingData.joinedAt
            >= THREE_DAYS
        ) {

            const guild =
                client.guilds.cache.first();

            if (!guild) continue;

            const member =
                await guild.members.fetch(userId)
                .catch(() => null);

            // User left already
            if (!member) {

                delete data.pending[userId];

                saveData();

                continue;

            }

            const recruiterId =
                pendingData.recruiterId;

            // Verified +1
            data.recruiters[
                recruiterId
            ].verified++;

            // Pending -1
            data.recruiters[
                recruiterId
            ].pending--;

            if (
                data.recruiters[
                    recruiterId
                ].pending < 0
            ) {

                data.recruiters[
                    recruiterId
                ].pending = 0;

            }

            // Save verified recruit
            data.verified[userId] =
                recruiterId;

            // Remove pending
            delete data.pending[userId];

saveData();

await updateLeaderboard(guild);

console.log(
    `${userId} verified after 3 days`
            );

        }

    }

}

// =====================================
// MEMBER LEAVE
// =====================================

client.on('guildMemberRemove',
async member => {

    // VERIFIED leaves
    const verifiedRecruiter =
        data.verified[member.user.id];

    if (verifiedRecruiter) {

        data.recruiters[
            verifiedRecruiter
        ].verified--;

        data.recruiters[
            verifiedRecruiter
        ].left++;

        if (
            data.recruiters[
                verifiedRecruiter
            ].verified < 0
        ) {

            data.recruiters[
                verifiedRecruiter
            ].verified = 0;

        }

delete data.verified[
    member.user.id
];

saveData();

await updateLeaderboard(member.guild);

}

    // PENDING leaves
    const pendingRecruiter =
        data.pending[member.user.id];

    if (pendingRecruiter) {

        data.recruiters[
            pendingRecruiter.recruiterId
        ].pending--;

        if (
            data.recruiters[
                pendingRecruiter.recruiterId
            ].pending < 0
        ) {

            data.recruiters[
                pendingRecruiter.recruiterId
            ].pending = 0;

        }

        delete data.pending[
            member.user.id
        ];

saveData();

await updateLeaderboard(member.guild);

    }

});

// =====================================
// COMMANDS
// =====================================

client.on('messageCreate',
async message => {

    if (message.author.bot) return;

// =====================================
// SET LEADERBOARD CHANNEL
// =====================================

if (
    message.content ===
    '!Ssetleaderboard'
) {

    settings[
        message.guild.id
    ] = {

        leaderboardChannel:
            message.channel.id

    };

    saveSettings();

    return message.reply(

        `✅ Leaderboard channel set to <#${message.channel.id}>`

    );

}

    // =====================================
    // PROFILE
    // =====================================

    if (
        message.content.startsWith('!Sprofile')
    ) {

        let target =
            message.mentions.members.first()
            || message.member;

        const recruiterData =
            data.recruiters[target.id];

        if (!recruiterData) {

            return message.reply(
                'No recruitment data found.'
            );

        }

        const sorted =
            Object.entries(data.recruiters)
            .sort((a, b) =>
                b[1].verified -
                a[1].verified
            );

        const rank =
            sorted.findIndex(
                user =>
                    user[0] === target.id
            ) + 1;

        const total =
            recruiterData.verified +
            recruiterData.left;

        let successRate = '100%';

        if (total > 0) {

            successRate =
                Math.round(
                    recruiterData.verified /
                    total * 100
                ) + '%';

        }

        const embed =
            new EmbedBuilder()

            .setColor(0x5865F2)

            .setTitle(
                '🏆 Recruit Profile'
            )

            .setThumbnail(
                target.user.displayAvatarURL({
                    dynamic: true
                })
            )

            .addFields(

                {
                    name: '👤 Recruiter',
                    value: target.displayName,
                    inline: false
                },

                {
                    name: '✅ Verified',
                    value: String(
                        recruiterData.verified
                    ),
                    inline: true
                },

                {
                    name: '⏳ Pending',
                    value: String(
                        recruiterData.pending
                    ),
                    inline: true
                },

                {
                    name: '❌ Lost',
                    value: String(
                        recruiterData.left
                    ),
                    inline: true
                },

                {
                    name: '🥇 Rank',
                    value: `#${rank}`,
                    inline: true
                },

                {
                    name: '⭐ Success Rate',
                    value: successRate,
                    inline: true
                }

            )

            .setFooter({
                text:
                    'Guild Recruitment Event'
            })

            .setTimestamp();

        message.channel.send({
            embeds: [embed]
        });

    }

    // =====================================
    // LEADERBOARD
    // =====================================

    if (
        message.content ===
        '!Sleaderboard'
    ) {

        await updateLeaderboard(
            message.guild
        );

        message.reply(
            'Leaderboard updated.'
        );

    }

    // =====================================
    // PENDING RECRUITS
    // =====================================

    if (
        message.content ===
        '!Spending'
    ) {

        let description = '';

        for (const userId in data.pending) {

            const pendingData =
                data.pending[userId];

            const member =
                await message.guild.members.fetch(userId)
                .catch(() => null);

            const recruiter =
                await message.guild.members.fetch(
                    pendingData.recruiterId
                ).catch(() => null);

            if (!member || !recruiter)
                continue;

            description +=
                `👤 ${member.displayName}\n` +
                `📨 Invited by ${recruiter.displayName}\n\n`;

        }

        const embed =
            new EmbedBuilder()

            .setColor(0xF1C40F)

            .setTitle(
                '⏳ Pending Recruits'
            )

            .setDescription(
                description ||
                'No pending recruits.'
            )

            .setTimestamp();

        message.channel.send({
            embeds: [embed]
        });

    }

    // =====================================
    // VERIFY LIST
    // =====================================

    if (
        message.content ===
        '!Sverifylist'
    ) {

        let description = '';

        const now = Date.now();

        for (const userId in data.pending) {

            const pendingData =
                data.pending[userId];

            const remaining =
                THREE_DAYS -
                (now - pendingData.joinedAt);

            const hours =
                Math.floor(
                    remaining /
                    (1000 * 60 * 60)
                );

            const member =
                await message.guild.members.fetch(userId)
                .catch(() => null);

            if (!member) continue;

            description +=
                `👤 ${member.displayName}\n` +
                `⏰ ${hours}h remaining\n\n`;

        }

        const embed =
            new EmbedBuilder()

            .setColor(0x2ECC71)

            .setTitle(
                '✅ Verification Queue'
            )

            .setDescription(
                description ||
                'No recruits waiting.'
            )

            .setTimestamp();

        message.channel.send({
            embeds: [embed]
        });

    }

    // =====================================
    // RECRUIT STATS
    // =====================================

    if (
        message.content ===
        '!Srecruitstats'
    ) {

        const totalRecruiters =
            Object.keys(data.recruiters)
            .length;

        let totalVerified = 0;
        let totalPending = 0;
        let totalLeft = 0;

        for (const recruiterId in data.recruiters) {

            totalVerified +=
                data.recruiters[
                    recruiterId
                ].verified;

            totalPending +=
                data.recruiters[
                    recruiterId
                ].pending;

            totalLeft +=
                data.recruiters[
                    recruiterId
                ].left;

        }

        const embed =
            new EmbedBuilder()

            .setColor(0x9B59B6)

            .setTitle(
                '📊 Recruitment Statistics'
            )

            .addFields(

                {
                    name: '👥 Recruiters',
                    value: String(
                        totalRecruiters
                    ),
                    inline: true
                },

                {
                    name: '✅ Verified',
                    value: String(
                        totalVerified
                    ),
                    inline: true
                },

                {
                    name: '⏳ Pending',
                    value: String(
                        totalPending
                    ),
                    inline: true
                },

                {
                    name: '❌ Lost',
                    value: String(
                        totalLeft
                    ),
                    inline: true
                }

            )

            .setTimestamp();

        message.channel.send({
            embeds: [embed]
        });

    }

    // =====================================
    // MY INVITES
    // =====================================

    if (
        message.content ===
        '!Smyinvites'
    ) {

        let verifiedList = '';

        for (const userId in data.verified) {

            const recruiterId =
                data.verified[userId];

            if (
                recruiterId !==
                message.member.id
            ) continue;

            const member =
                await message.guild.members.fetch(userId)
                .catch(() => null);

            if (!member) continue;

            verifiedList +=
                `👤 ${member.displayName}\n`;

        }

        const embed =
            new EmbedBuilder()

            .setColor(0x3498DB)

            .setTitle(
                `📨 ${message.member.displayName}'s Recruits`
            )

            .setDescription(
                verifiedList ||
                'No verified recruits.'
            )

            .setTimestamp();

        message.channel.send({
            embeds: [embed]
        });

    }

    // =====================================
    // HELP
    // =====================================

    if (
        message.content ===
        '!Shelp'
    ) {

        const embed =
            new EmbedBuilder()

            .setColor(0x5865F2)

            .setTitle(
                '🤖 Recruitment Bot Commands'
            )

            .setDescription(

`🏆 !Sprofile
Show your recruit profile

👤 !Sprofile @user
Show another user's profile

📊 !Sleaderboard
Update leaderboard

⏳ !Spending
Show pending recruits

✅ !Sverifylist
Show recruits waiting for verification

📈 !Srecruitstats
Show server recruitment stats

📨 !Smyinvites
Show your verified recruits

❓ !Shelp
Show command list`

            )

            .setTimestamp();

        message.channel.send({
            embeds: [embed]
        });

    }

});

// =====================================
// LEADERBOARD
// =====================================

async function updateLeaderboard(guild) {

const channelId =
    settings[guild.id]
        ?.leaderboardChannel;

if (!channelId) {

    console.log(
        `No leaderboard channel set for ${guild.name}`
    );

    return;

}

const channel =
    guild.channels.cache.get(
        channelId
    );

    if (!channel) return;

    const sorted =
        Object.entries(data.recruiters)
        .sort((a, b) =>
            b[1].verified -
            a[1].verified
        );

    let description = '';

    for (let i = 0; i < sorted.length; i++) {

        const [userId, stats] =
            sorted[i];

        const member =
            await guild.members.fetch(userId)
            .catch(() => null);

        const displayName =
            member
            ? member.displayName
            : 'Unknown User';

        let medal = '🏅';

        if (i === 0) medal = '🥇';
        if (i === 1) medal = '🥈';
        if (i === 2) medal = '🥉';

        description +=
            `${medal} ${displayName} — ${stats.verified} recruits\n`;

    }

    let thumbnail = null;

    if (sorted.length > 0) {

        const topMember =
            await guild.members.fetch(
                sorted[0][0]
            ).catch(() => null);

        if (topMember) {

            thumbnail =
                topMember.user
                .displayAvatarURL({
                    dynamic: true
                });

        }

    }

    const embed =
        new EmbedBuilder()

        .setColor(0x5865F2)

        .setTitle(
            `🏆 ${guild.name} Recruitment Leaderboard`
        )

        .setDescription(
            description ||
            'No recruits yet.'
        )

        .setFooter({
            text:
                'Guild Recruitment Event'
        })

        .setTimestamp();

    if (thumbnail) {

        embed.setThumbnail(
            thumbnail
        );

    }

    // Edit old message
    if (leaderboardData.messageId) {

        try {

            const oldMessage =
                await channel.messages.fetch(
                    leaderboardData.messageId
                );

            await oldMessage.edit({
                embeds: [embed]
            });

            return;

        } catch {}

    }

    // Create new leaderboard
    const sentMessage =
        await channel.send({
            embeds: [embed]
        });

    leaderboardData.messageId =
        sentMessage.id;

    fs.writeFileSync(
        './leaderboard.json',
        JSON.stringify(
            leaderboardData,
            null,
            2
        )
    );

}

// =====================================
// AUTO LEADERBOARD UPDATE
// =====================================

function startLeaderboardUpdates() {

    setInterval(async () => {

        const guild =
            client.guilds.cache.first();

        if (!guild) return;

        await updateLeaderboard(
            guild
        );

    }, UPDATE_INTERVAL);

}

client.login(process.env.TOKEN);