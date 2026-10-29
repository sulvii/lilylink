export interface Track {
	encoded: string;
	info: TrackInfo;
	pluginInfo: object;
	userData: object;
}
export interface TrackInfo {
	title: string;
	uri?: string;
	author: string;
	length: number;
	isStream: boolean;
	isSeekable: boolean;
	position: number;
	artworkUrl?: string;
	identifier?: string;
	isrc?: string;
	sourceName?: string;
}

export class LilyTrack {
	public encoded: string;
	public url?: string;
	public author: string;
	public duration: number;
	public title: string;
	public position: number;
	public identifier?: string;
	public isSeekable: boolean;
	public isStream: boolean;
	public artworkUrl?: string;
	public isrc?: string;
	public time?: number = 0;
	public sourceName?: string;
	public requestedBy?: string;
	constructor(trackData: Track, requester?: string) {
		this.encoded = trackData.encoded;
		this.url = trackData.info.uri;
		this.author = trackData.info.author;
		this.duration = trackData.info.length;
		this.title = trackData.info.title;
		this.position = trackData.info.position;
		this.identifier = trackData.info.identifier;
		this.isSeekable = trackData.info.isSeekable;
		this.isStream = trackData.info.isStream;
		this.artworkUrl = trackData.info.artworkUrl;
		this.isrc = trackData.info.isrc;
		this.sourceName = trackData.info.sourceName;

		if (requester) {
			this.requestedBy = requester;
		}
	}
}
