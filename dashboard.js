const express = require('express');
const fs = require('fs');

require('dotenv').config();

const {
    Client,
    GatewayIntentBits
} = require('discord.js');

const app = express();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// =====================================
// LOGIN BOT
// =====================================

client.login(process.env.TOKEN);

// =====================================
// DASHBOARD
// =====================================

app.get('/', async (req, res) => {

    const data = JSON.parse(
        fs.readFileSync('./recruits.json')
    );

    const guild =
        client.guilds.cache.first();

    // =====================================
    // GLOBAL STATS
    // =====================================

    let totalVerified = 0;
    let totalPending = 0;
    let totalLost = 0;

    for (const recruiterId in data.recruiters) {

        totalVerified +=
            data.recruiters[
                recruiterId
            ].verified;

        totalPending +=
            data.recruiters[
                recruiterId
            ].pending;

        totalLost +=
            data.recruiters[
                recruiterId
            ].left;

    }

    let html = `

    <html>

    <head>

        <title>
            Shadow Recruitment Dashboard
        </title>

        <style>

            body {

                background:
                linear-gradient(
                    180deg,
                    #0f0f0f,
                    #161616
                );

                color: white;
                font-family: Arial;
                padding: 30px;

            }

            h1 {

                color: #5865F2;
                margin-bottom: 10px;
                font-size: 48px;

            }

            .subtitle {

                color: #999;
                margin-bottom: 40px;
                font-size: 18px;

            }

            .topstats {

                display: flex;
                gap: 20px;
                margin-bottom: 40px;

            }

            .topcard {

                flex: 1;

                background: #1b1b1b;

                padding: 25px;

                border-radius: 16px;

                text-align: center;

                box-shadow:
                0 0 20px rgba(0,0,0,0.3);

            }

            .topnumber {

                font-size: 42px;
                font-weight: bold;

                margin-top: 10px;

            }

            .card {

                background: #1a1a1a;

                padding: 25px;

                margin-bottom: 20px;

                border-radius: 18px;

                display: flex;

                align-items: center;

                gap: 25px;

                transition: 0.2s;

                box-shadow:
                0 0 20px rgba(0,0,0,0.2);

            }

            .card:hover {

                transform: scale(1.01);

                background: #222;

            }

            .avatar {

                width: 100px;
                height: 100px;

                border-radius: 50%;

                border:
                3px solid #5865F2;

            }

            .stats {

                flex: 1;

            }

            .name {

                font-size: 34px;
                font-weight: bold;

                margin-bottom: 18px;

            }

            .stat {

                margin-bottom: 10px;

                font-size: 20px;

            }

            .success {

                color: #57F287;
                font-weight: bold;

            }

        </style>

    </head>

    <body>

        <h1>
            🏆 Recruitment Dashboard
        </h1>

        <div class="subtitle">

            ${guild.name}

        </div>

        <div class="topstats">

            <div class="topcard">

                ✅ Verified

                <div class="topnumber">

                    ${totalVerified}

                </div>

            </div>

            <div class="topcard">

                ⏳ Pending

                <div class="topnumber">

                    ${totalPending}

                </div>

            </div>

            <div class="topcard">

                ❌ Lost

                <div class="topnumber">

                    ${totalLost}

                </div>

            </div>

        </div>

    `;

    const sorted =
        Object.entries(data.recruiters)
        .sort((a, b) =>
            b[1].verified -
            a[1].verified
        );

    for (let i = 0; i < sorted.length; i++) {

        const [userId, stats] =
            sorted[i];

        let member = null;

        try {

            member =
                await guild.members.fetch(userId);

        } catch {}

        const name =
            member
            ? member.displayName
            : 'Unknown User';

        const avatar =
            member
            ? member.user.displayAvatarURL()
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        let medal = '🏅';

        if (i === 0) medal = '🥇';
        if (i === 1) medal = '🥈';
        if (i === 2) medal = '🥉';

        const total =
            stats.verified +
            stats.left;

        let successRate = '100%';

        if (total > 0) {

            successRate =
                Math.round(
                    stats.verified /
                    total * 100
                ) + '%';

        }

        html += `

        <div class="card">

            <img
                class="avatar"
                src="${avatar}"
            >

            <div class="stats">

                <div class="name">

                    ${medal} ${name}

                </div>

                <div class="stat">
                    ✅ Verified:
                    ${stats.verified}
                </div>

                <div class="stat">
                    ⏳ Pending:
                    ${stats.pending}
                </div>

                <div class="stat">
                    ❌ Lost:
                    ${stats.left}
                </div>

                <div class="stat success">
                    ⭐ Success Rate:
                    ${successRate}
                </div>

            </div>

        </div>

        `;

    }

    html += `
    </body>
    </html>
    `;

    res.send(html);

});

// =====================================
// START WEBSITE
// =====================================

app.listen(3000, () => {

    console.log(
        'Dashboard running on port 3000'
    );

});