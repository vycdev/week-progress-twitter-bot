import "dotenv/config";

import TwitterApi from "twitter-api-v2";

import fs from "fs";

import koa from "koa";
import Router from "koa-router";
import logger from "koa-logger";
import bodyParser from "koa-bodyparser";

import { errorHandler } from "./error/errorHandler";

const port = Number(process.env.PORT || 5000);
const app = new koa();
const router = new Router();

const twitterClient = new TwitterApi({
    clientId: process.env.CLIENT_ID || "",
    clientSecret: process.env.CLIENT_SECRET || "",
});

const callbackURL = "http://127.0.0.1:5000/callback";

router.get("/", async (ctx, next) => {
    ctx.status = 200;
    ctx.body = {
        message: `Welcome to the app, to be redirected to the OAuth request link go to ${ctx.href}oauth`,
    };
    await next();
});

router.get("/oauth", async (ctx, next) => {
    const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
        callbackURL,
        { scope: ["tweet.write", "tweet.read", "users.read", "offline.access"] }
    );

    console.log(url, codeVerifier, state);

    const data = { codeVerifier, state };

    fs.writeFileSync("data.json", JSON.stringify(data));

    ctx.redirect(url);
    await next();
});

router.get("/callback", async (ctx, next) => {
    console.log(ctx.query.state, ctx.query.code);

    const state = String(ctx.query.state);
    const code = String(ctx.query.code);

    const storedData = await JSON.parse(fs.readFileSync("data.json", "utf-8"));
    if (!storedData.codeVerifier || !storedData.state || !state || !code) {
        ctx.status = 400;
        ctx.body = { message: "Bad request." };
        return;
    }

    if (state !== storedData.state) {
        ctx.status = 400;
        ctx.body = { message: "Bad request." };
        return;
    }

    const {
        client: loggedClient,
        accessToken,
        refreshToken,
    } = await twitterClient.loginWithOAuth2({
        code,
        codeVerifier: storedData.codeVerifier,
        redirectUri: callbackURL,
    });

    const data = {
        codeVerifier: storedData.codeVerifier,
        accessToken,
        refreshToken,
        state,
    };

    fs.writeFileSync("data.json", JSON.stringify(data));

    ctx.status = 200;
    ctx.body = {
        message: "The params have been saved.",
    };

    await next();
});

router.get("/tweet", async (ctx, next) => {
    const text = ctx.query.message;

    if (!text) {
        ctx.status = 400;
        ctx.body = {
            message:
                "Bad request. You need to have a query parameter called 'message' that's less than 280 characters long in the link.",
        };
        return;
    }
    if (text!.length > 280) {
        ctx.status = 400;
        ctx.body = { message: "Bad request. Your message is too long." };
        return;
    }

    const storedData = await JSON.parse(fs.readFileSync("data.json", "utf-8"));

    if (!storedData.refreshToken) {
        ctx.status = 400;
        ctx.body = { message: "Bad request. The refresh token doesn't exist." };
        return;
    }

    const {
        client: refreshedClient,
        accessToken,
        refreshToken: newRefreshToken,
    } = await twitterClient.refreshOAuth2Token(storedData.refreshToken);

    const data = {
        codeVerifier: storedData.codeVerifier,
        accessToken,
        refreshToken: newRefreshToken,
        state: storedData.state,
    };

    fs.writeFileSync("data.json", JSON.stringify(data));

    await refreshedClient.v2.tweet(String(text));

    ctx.status = 200;
    ctx.body = { message: `The text "${text}" has been tweeted.` };
    await next();
});

const getNextDayOfWeek = (date: Date, dayOfWeek: number) => {
    const resultDate = new Date(new Date(date.getTime()).setUTCHours(0, 0, 0, 0));

    resultDate.setDate(date.getDate() + (7 + dayOfWeek - date.getDay()) % 7);

    return resultDate;
}

const getTweetString = async (): Promise<string> => {
    const current = new Date();
    const endOfWeek = new Date(new Date(getNextDayOfWeek(new Date(current), 5)).setUTCHours(23, 59, 59))

    const hoursLeft = Math.floor(((endOfWeek.getTime() - current.getTime()) / 36e5) * 100) / 100
    const weekLength = 24 * 7

    if (current.getDay() === 0) {
        return "It's Sunday!"
    }
    if (current.getDay() === 6) {
        return "It's Saturday!"
    }

    const progress = Math.abs(Math.floor((1 - (hoursLeft / weekLength)) * 10000) / 10000)

    // console.log(endOfWeek);
    // console.log(hoursLeft);
    // console.log(weekLength);
    // console.log(progress);

    const filled = Math.ceil((progress * 1.5) * 10)
    // console.log(filled, 15 - filled);


    // console.log("▓".repeat(filled) + "░".repeat(15 - filled))
    //▓▓▓▓▓▓▓▓ ▓ ░░░░░░

    return `${"▓".repeat(filled)}${"░".repeat(15 - filled)} ${Math.floor(progress * 10000) / 100}%\n${hoursLeft} hours left until the weekend.`
}

// console.log(getTweetString());


const RecurringTweets = async () => {
    const storedData = await JSON.parse(fs.readFileSync("data.json", "utf-8"));
    if (
        !storedData.refreshToken ||
        !storedData.codeVerifier ||
        !storedData.state
    ) {
        console.info(
            "No stored data available for tweeting. You need to grant access to the app first for the reccurring tweets to activate."
        );
        return;
    }

    const {
        client: refreshedClient,
        accessToken,
        refreshToken: newRefreshToken,
    } = await twitterClient.refreshOAuth2Token(storedData.refreshToken);

    const data = {
        codeVerifier: storedData.codeVerifier,
        accessToken,
        refreshToken: newRefreshToken,
        state: storedData.state,
    };

    fs.writeFileSync("data.json", JSON.stringify(data));

    const result = await refreshedClient.v2.tweet(await getTweetString());

    if (result.errors)
        console.log(result.errors);
};

app.use(errorHandler());
app.use(bodyParser());
app.use(logger());
app.use(router.routes()).use(router.allowedMethods());

if (process.env.NODE_ENV === "development")
    app.listen(port, () => {
        console.info(`Koa app started and listening to port ${port}! 🚀`);
    });

try {
    RecurringTweets()
} catch (error) {
    console.error(error)
}
