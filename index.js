require('dotenv').config();

const db = require('./database');

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


// =====================================
// SAVE DATABASE
// =====================================

function getRecruiter(userId) {

    let recruiter =
        db.prepare(`
            SELECT * FROM recruiters
            WHERE userId = ?
        `).get(userId);

    if (!recruiter) {

        db.prepare(`
            INSERT INTO recruiters
            (userId, verified, pending, lost)
            VALUES (?, 0, 0, 0)
        `).run(userId);

        recruiter =
            db.prepare(`
                SELECT * FROM recruiters
                WHERE userId = ?
            `).get(userId);
    }

    return recruiter;
}

function updateRecruiter(userId, verified, pending, lost) {


    db.prepare(`
        UPDATE recruiters
        SET verified = ?,
            pending = ?,
            lost = ?
        WHERE userId = ?
    `).run(
        verified,
        pending,
        lost,
        userId
    );
}

function setSetting(key, value) {

    db.prepare(`
        INSERT OR REPLACE INTO settings
        (key, value)
        VALUES (?, ?)
    `).run(key, value);

}

function getSetting(key) {

    const row =
        db.prepare(`
            SELECT value FROM settings
            WHERE key = ?
        `).get(key);

    return row ? row.value : null;

}

// =====================================
// READY
// =====================================

client.once('clientReady', async () => {

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

// get recruiter from DB
let recruiter =
    getRecruiter(recruiterId);

// increase pending count
updateRecruiter(
    recruiterId,
    recruiter.verified,
    recruiter.pending + 1,
    recruiter.lost
);

// save pending recruit in database
db.prepare(`
    INSERT OR REPLACE INTO pending_recruits
    (memberId, recruiterId, joinedAt)
    VALUES (?, ?, ?)
`).run(
    member.user.id,
    recruiterId,
    Date.now()
);

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

    // get all pending recruits
    const pendingList =
        db.prepare(`
            SELECT * FROM pending_recruits
        `).all();

    for (const pendingData of pendingList) {

        if (
            now - pendingData.joinedAt
            >= THREE_DAYS
        ) {

            const guild =
                client.guilds.cache.first();

            if (!guild) continue;

            const member =
                await guild.members
                    .fetch(
                        pendingData.memberId
                    )
                    .catch(() => null);

            // user left already
            if (!member) {

                db.prepare(`
                    DELETE FROM pending_recruits
                    WHERE memberId = ?
                `).run(
                    pendingData.memberId
                );

                continue;
            }

            const recruiterId =
                pendingData.recruiterId;

            let recruiter =
                getRecruiter(
                    recruiterId
                );

            let newPending =
                recruiter.pending - 1;

            if (newPending < 0)
                newPending = 0;

            // move pending → verified
            updateRecruiter(
                recruiterId,
                recruiter.verified + 1,
                newPending,
                recruiter.lost
            );
	// save verified recruit
		db.prepare(`
 		   INSERT OR REPLACE INTO verified_recruits
   		 (memberId, recruiterId, verifiedAt)
 		   VALUES (?, ?, ?)
			`).run(
  		  pendingData.memberId,
		    recruiterId,
		    Date.now()
		);
            // remove pending recruit
            db.prepare(`
                DELETE FROM pending_recruits
                WHERE memberId = ?
            `).run(
                pendingData.memberId
            );

            console.log(
                `${pendingData.memberId} verified after 3 days`
            );

            await updateLeaderboard(
                guild
            );

        }

    }

}

// =====================================
// MEMBER LEAVE
// =====================================

client.on('guildMemberRemove',
async member => {

	    // check verified recruit
    const verified =
        db.prepare(`
            SELECT * FROM verified_recruits
            WHERE memberId = ?
        `).get(member.user.id);

    if (verified) {

        let recruiter =
            getRecruiter(
                verified.recruiterId
            );

        let newVerified =
            recruiter.verified - 1;

        if (newVerified < 0)
            newVerified = 0;

        updateRecruiter(
            verified.recruiterId,
            newVerified,
            recruiter.pending,
            recruiter.lost + 1
        );

        // remove verified recruit
        db.prepare(`
            DELETE FROM verified_recruits
            WHERE memberId = ?
        `).run(member.user.id);

        await updateLeaderboard(
            member.guild
        );

        return;
    }

    // check pending recruit
    const pending =
        db.prepare(`
            SELECT * FROM pending_recruits
            WHERE memberId = ?
        `).get(member.user.id);

    if (pending) {

        let recruiter =
            getRecruiter(
                pending.recruiterId
            );

        let newPending =
            recruiter.pending - 1;

        if (newPending < 0)
            newPending = 0;

        updateRecruiter(
            pending.recruiterId,
            recruiter.verified,
            newPending,
            recruiter.lost
        );

        // delete pending recruit
        db.prepare(`
            DELETE FROM pending_recruits
            WHERE memberId = ?
        `).run(member.user.id);

        await updateLeaderboard(
            member.guild
        );

        return;
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

    if (
    message.content ===
    '!Ssetleaderboard'
) {

    setSetting(
        `leaderboard_${message.guild.id}`,
        message.channel.id
    );

    return message.reply(

        `✅ Leaderboard channel set to <#${message.channel.id}>`

    );

}

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

    // get recruiter from DB
    const recruiterData =
        db.prepare(`
            SELECT * FROM recruiters
            WHERE userId = ?
        `).get(target.id);

    if (!recruiterData) {

        return message.reply(
            'No recruitment data found.'
        );

    }

    // get all recruiters for ranking
    const sorted =
        db.prepare(`
            SELECT * FROM recruiters
            ORDER BY
            (verified + pending) DESC
        `).all();

    const rank =
        sorted.findIndex(
            user =>
                user.userId === target.id
        ) + 1;

    const total =
        recruiterData.verified +
        recruiterData.lost;

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
                    recruiterData.lost
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

    // get all pending recruits from DB
    const pendingList =
        db.prepare(`
            SELECT * FROM pending_recruits
        `).all();

    for (const pendingData of pendingList) {

        const member =
            await message.guild.members.fetch(
                pendingData.memberId
            ).catch(() => null);

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

    const pendingList =
        db.prepare(`
            SELECT * FROM pending_recruits
        `).all();

    for (const pendingData of pendingList) {

        const remaining =
            THREE_DAYS -
            (now - pendingData.joinedAt);

        const hours =
            Math.floor(
                remaining /
                (1000 * 60 * 60)
            );

        const member =
            await message.guild.members.fetch(
                pendingData.memberId
            ).catch(() => null);

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

    // get all recruiters
    const recruiters =
        db.prepare(`
            SELECT * FROM recruiters
        `).all();

    const totalRecruiters =
        recruiters.length;

    let totalVerified = 0;
    let totalPending = 0;
    let totalLost = 0;

    for (const recruiter of recruiters) {

        totalVerified +=
            recruiter.verified;

        totalPending +=
            recruiter.pending;

        totalLost +=
            recruiter.lost;

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
                    totalLost
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

    const verifiedRecruits =
        db.prepare(`
            SELECT * FROM verified_recruits
            WHERE recruiterId = ?
        `).all(
            message.member.id
        );

    for (const recruit of verifiedRecruits) {

        const member =
            await message.guild.members.fetch(
                recruit.memberId
            ).catch(() => null);

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
    getSetting(
        `leaderboard_${guild.id}`
    );

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
    db.prepare(`
        SELECT * FROM recruiters
        ORDER BY
        (verified + pending) DESC
    `).all();

	
    let description = '';

for (let i = 0; i < sorted.length; i++) {

    const stats =
        sorted[i];

    const userId =
        stats.userId;

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
    `${medal} ${displayName}\n` +
    `✅ ${stats.verified} Verified | ⏳ ${stats.pending} Pending | ❌ ${stats.lost} Lost\n\n`;

}

let thumbnail = null;
    if (sorted.length > 0) {

        const topMember =
            await guild.members.fetch(
                sorted[0].userId
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
    const oldMessageId =
    getSetting(
        `leaderboard_message_${guild.id}`
    );

if (oldMessageId) {

    try {

        const oldMessage =
            await channel.messages.fetch(
                oldMessageId
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

setSetting(
    `leaderboard_message_${guild.id}`,
    sentMessage.id
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