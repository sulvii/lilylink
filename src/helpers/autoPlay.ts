import { createHmac } from "node:crypto";
import { lilyRequest } from "./request";

const NOSCRIPT_RE = /<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi;
const ARTICLE_RE = /<article\b[\s\S]*?<\/article>/gi;
const TRACK_LINK_RE =
	/<h2\b[^>]*\bitemprop="name"[^>]*>\s*(<a\b[^>]*\bitemprop="url"[^>]*>)/i;
const HREF_RE = /\bhref="([^"]*)"/i;

export async function scAutoPlay(url: string) {
	const [response, error] = await lilyRequest<string, Error>(
		`${url}/recommended`,
		{},
		false,
	);

	if (error || !response) {
		throw new Error(
			`Failed to fetch URL: ${error?.message || "Unknown error"}`,
		);
	}

	const html = response as string;

	const noscripts = [...html.matchAll(NOSCRIPT_RE)];
	const content = noscripts[1]?.[1] ?? "";

	const tracks: string[] = [];

	for (const [article] of content.matchAll(ARTICLE_RE)) {
		const anchor = TRACK_LINK_RE.exec(article)?.[1];
		const href = anchor ? HREF_RE.exec(anchor)?.[1] : undefined;

		if (href) {
			tracks.push(`https://soundcloud.com${href.replaceAll("&amp;", "&")}`);
		}
	}

	return tracks;
}

export async function spAutoPlay(track_id: string): Promise<string> {
	const TOTP_SECRET: Uint8Array = new Uint8Array([
		53, 53, 48, 55, 49, 52, 53, 56, 53, 51, 52, 56, 55, 52, 57, 57, 53, 57, 50,
		50, 52, 56, 54, 51, 48, 51, 50, 57, 51, 52, 55,
	]);

	function generateTotp(): [string, number] {
		const counter = Math.floor(Date.now() / 30000);
		const counterBuffer = Buffer.alloc(8);
		counterBuffer.writeBigInt64BE(BigInt(counter));

		const hmac = createHmac("sha1", TOTP_SECRET);
		hmac.update(counterBuffer);
		const hmacResult = hmac.digest();

		const offset = hmacResult[hmacResult.length - 1] & 15;
		const truncatedValue =
			((hmacResult[offset] & 127) << 24) |
			((hmacResult[offset + 1] & 255) << 16) |
			((hmacResult[offset + 2] & 255) << 8) |
			(hmacResult[offset + 3] & 255);

		const totp = (truncatedValue % 1000000).toString().padStart(6, "0");
		return [totp, counter * 30000];
	}

	const [totp, timestamp] = generateTotp();
	const params = new URLSearchParams({
		reason: "init",
		productType: "web-player",
		totp,
		totpVer: "5",
		ts: timestamp.toString(),
	});

	let accessToken: string;
	try {
		const [tokenData, tokenError] = await lilyRequest<
			{ accessToken: string },
			Error
		>(`https://open.spotify.com/api/token?${params.toString()}`);
		if (tokenError || !tokenData) {
			throw new Error(
				`Token request failed: ${tokenError?.message || "Unknown error"}`,
			);
		}

		if (!tokenData.accessToken) {
			throw new Error("Access token missing in response.");
		}

		accessToken = tokenData.accessToken;
	} catch (error) {
		throw new Error(
			`Failed to fetch access token: ${(error as Error).message}`,
		);
	}

	let recommendedTracks: { id: string }[];
	try {
		const [recommendationsData, recommendationsError] = await lilyRequest<
			{ tracks: { id: string }[] },
			Error
		>(
			`https://api.spotify.com/v1/recommendations?limit=10&seed_tracks=${track_id}`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
			},
		);

		if (recommendationsError || !recommendationsData) {
			throw new Error(
				`Spotify API request failed: ${recommendationsError?.message || "Unknown error"}`,
			);
		}

		recommendedTracks = recommendationsData.tracks;
	} catch (error) {
		throw new Error(
			`Failed to fetch recommendations: ${(error as Error).message}`,
		);
	}

	if (!recommendedTracks || recommendedTracks.length === 0) {
		throw new Error("No recommended tracks found.");
	}

	return recommendedTracks[Math.floor(Math.random() * recommendedTracks.length)]
		.id;
}

export async function autoPlayProvider(
	provider: "soundcloud" | "spotify",
	track_id: string,
) {
	if (provider === "soundcloud") {
		return scAutoPlay(track_id);
	}
	if (provider === "spotify") {
		return spAutoPlay(track_id);
	}

	throw new Error("Invalid provider");
}
