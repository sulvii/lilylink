import type { LilyPlayer } from "./player";
import type { LilyRestHandler } from "./rest";

export interface Equalizer {
	readonly band: number;
	readonly gain: number;
}

export interface Karaoke {
	readonly level?: number;
	readonly monoLevel?: number;
	readonly filterBand?: number;
	readonly filterWidth?: number;
}

export interface Timescale {
	readonly speed?: number;
	readonly pitch?: number;
	readonly rate?: number;
}

export interface Tremolo {
	readonly frequency?: number;
	readonly depth?: number;
}

export interface Vibrato {
	readonly frequency?: number;
	readonly depth?: number;
}

export interface Rotation {
	readonly rotationHz?: number;
}

export interface Distortion {
	readonly sinOffset?: number;
	readonly sinScale?: number;
	readonly cosOffset?: number;
	readonly cosScale?: number;
	readonly tanOffset?: number;
	readonly tanScale?: number;
	readonly offset?: number;
	readonly scale?: number;
}

export interface ChannelMix {
	readonly leftToLeft?: number;
	readonly leftToRight?: number;
	readonly rightToLeft?: number;
	readonly rightToRight?: number;
}

export interface LowPass {
	readonly smoothing?: number;
}
export interface Reverb {
	wet?: number;
	dry?: number;
	roomSize?: number;
	damping?: number;
}

export interface FilterMap {
	volume: number | null;
	equalizer: Equalizer[] | null;
	karaoke: Karaoke | null;
	timescale: Timescale | null;
	tremolo: Tremolo | null;
	vibrato: Vibrato | null;
	rotation: Rotation | null;
	distortion: Distortion | null;
	channelMix: ChannelMix | null;
	lowPass: LowPass | null;
	reverb: Reverb | null;
}

export class LilyFilters {
	private readonly player: LilyPlayer;
	private readonly rest: LilyRestHandler;
	private filters: FilterMap;
	private updateTimeout: NodeJS.Timeout | null = null;
	private static readonly UPDATE_DEBOUNCE_MS = 50;
	private static readonly VALIDATION_RANGES = {
		volume: { min: -50, max: 50 },
		equalizer: { bandMin: 0, bandMax: 14, gainMin: -0.25, gainMax: 1.0 },
		timescale: {
			speedMin: 0,
			speedMax: 5,
			pitchMin: 0,
			pitchMax: 5,
			rateMin: 0,
			rateMax: 5,
		},
	};

	constructor(player: LilyPlayer) {
		this.player = player;
		this.rest = player.node.rest;
		this.filters = this.initializeFilters();
	}

	private initializeFilters(): FilterMap {
		return {
			volume: this.getPlayerFilter<number>("Fvolume"),
			equalizer: this.getPlayerFilter<Equalizer[]>("equalizer"),
			karaoke: this.getPlayerFilter<Karaoke>("karaoke"),
			timescale: this.getPlayerFilter<Timescale>("timescale"),
			tremolo: this.getPlayerFilter<Tremolo>("tremolo"),
			vibrato: this.getPlayerFilter<Vibrato>("vibrato"),
			rotation: this.getPlayerFilter<Rotation>("rotation"),
			distortion: this.getPlayerFilter<Distortion>("distortion"),
			channelMix: this.getPlayerFilter<ChannelMix>("channelMix"),
			lowPass: this.getPlayerFilter<LowPass>("lowPass"),
			reverb: this.getPlayerFilter<Reverb>("reverb"),
		};
	}

	private getPlayerFilter<T>(key: string): T | null {
		try {
			return this.player.get(key) ?? null;
		} catch {
			return null;
		}
	}

	private validateNumber(value: number, min: number, max: number): boolean {
		return (
			typeof value === "number" &&
			!Number.isNaN(value) &&
			value >= min &&
			value <= max
		);
	}

	private validateEqualizer(equalizer: Equalizer[]): boolean {
		return (
			Array.isArray(equalizer) &&
			equalizer.every(
				(eq) =>
					this.validateNumber(
						eq.band,
						LilyFilters.VALIDATION_RANGES.equalizer.bandMin,
						LilyFilters.VALIDATION_RANGES.equalizer.bandMax,
					) &&
					this.validateNumber(
						eq.gain,
						LilyFilters.VALIDATION_RANGES.equalizer.gainMin,
						LilyFilters.VALIDATION_RANGES.equalizer.gainMax,
					),
			)
		);
	}

	private async setFilter<K extends keyof FilterMap>(
		filterName: K,
		value: FilterMap[K],
	): Promise<this> {
		try {
			if (value !== null) {
				switch (filterName) {
					case "volume":
						if (
							!this.validateNumber(
								value as number,
								LilyFilters.VALIDATION_RANGES.volume.min,
								LilyFilters.VALIDATION_RANGES.volume.max,
							)
						) {
							throw new Error(`Invalid volume value: ${value}`);
						}
						break;
					case "equalizer":
						if (!this.validateEqualizer(value as Equalizer[])) {
							throw new Error("Invalid equalizer configuration");
						}
						break;
				}
			}

			this.player.set(filterName, value);
			this.filters[filterName] = value;

			if (this.updateTimeout) {
				clearTimeout(this.updateTimeout);
			}

			this.updateTimeout = setTimeout(() => {
				this.updateFiltersFromRest().catch((error) => {
					console.error("Failed to update filters:", error);
					this.player.set(filterName, this.filters[filterName]);
				});
				this.updateTimeout = null;
			}, LilyFilters.UPDATE_DEBOUNCE_MS);

			return this;
		} catch (error) {
			console.error(`Error setting filter ${filterName}:`, error);
			throw error;
		}
	}

	public setVolume(volume: number | null): Promise<this> {
		return this.setFilter("volume", volume);
	}

	public setEqualizer(equalizer: Equalizer[] | null): Promise<this> {
		return this.setFilter("equalizer", equalizer);
	}

	public setKaraoke(karaoke: Karaoke | null): Promise<this> {
		return this.setFilter("karaoke", karaoke);
	}

	public setTimescale(timescale: Timescale | null): Promise<this> {
		return this.setFilter("timescale", timescale);
	}

	public setTremolo(tremolo: Tremolo | null): Promise<this> {
		return this.setFilter("tremolo", tremolo);
	}

	public setVibrato(vibrato: Vibrato | null): Promise<this> {
		return this.setFilter("vibrato", vibrato);
	}

	public setRotation(rotation: Rotation | null): Promise<this> {
		return this.setFilter("rotation", rotation);
	}

	public setDistortion(distortion: Distortion | null): Promise<this> {
		return this.setFilter("distortion", distortion);
	}

	public setChannelMix(channelMix: ChannelMix | null): Promise<this> {
		return this.setFilter("channelMix", channelMix);
	}

	public setLowPass(lowPass: LowPass | null): Promise<this> {
		return this.setFilter("lowPass", lowPass);
	}
	public setReverb(reverb: Reverb | null): Promise<this> {
		return this.setFilter("reverb", reverb);
	}

	public async resetFilters(): Promise<this> {
		try {
			await Promise.all(
				Object.keys(this.filters).map((key) =>
					this.setFilter(key as keyof FilterMap, null),
				),
			);
			return this;
		} catch (error) {
			console.error("Failed to reset filters:", error);
			throw error;
		}
	}

	private async updateFiltersFromRest(): Promise<boolean> {
		try {
			const cleanedFilters = Object.fromEntries(
				Object.entries(this.filters).filter(([_, v]) => v !== null),
			);
			const dataToUpdate = {
				guildId: this.player.guildId,
				data: {
					filters: cleanedFilters,
				},
			};
			await this.rest.update(dataToUpdate);
			return true;
		} catch (error) {
			console.error("Failed to update filters from REST:", error);
			throw error;
		}
	}

	public getFilters(): Readonly<FilterMap> {
		return Object.freeze({ ...this.filters });
	}

	public dispose(): void {
		if (this.updateTimeout) {
			clearTimeout(this.updateTimeout);
			this.updateTimeout = null;
		}
	}
}
