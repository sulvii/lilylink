import ky, { Options } from "ky";

export const lilyRequest = async <T, E = unknown>(
	url: URL | string,
	options: Options = {},
	json = true,
) => {
	try {
		const res = await ky(url, options);

		if (json) {
			return [(await res.json()) as T, undefined] as const;
		}

		return [(await res.text()) as unknown as T, undefined] as const;
	} catch (error) {
		return [undefined, error as E] as const;
	}
};
