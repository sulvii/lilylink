import { safeParse, type GenericSchema } from "valibot";

export function validate<T>(
	prop: T,
	validator: GenericSchema<T>,
	errorMessage: string,
	ErrorClass: new (message: string) => Error = Error,
): asserts prop is T {
	const result = safeParse(validator, prop);

	if (!result.success) {
		const details = result.issues.map((issue) => issue.message).join(", ");
		throw new ErrorClass(`${errorMessage}: ${details}`);
	}
}
