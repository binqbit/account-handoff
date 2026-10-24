import type { ErrorObject } from 'ajv';
type Validator = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
export const validateRecordSchema: Validator;
export const validateProgressSchema: Validator;
export const validatePackageSchema: Validator;
export const validateIntentSchema: Validator;
export const validateCallTreeSchema: Validator;
