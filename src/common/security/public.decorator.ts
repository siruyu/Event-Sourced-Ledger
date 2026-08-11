import { SetMetadata } from '@nestjs/common';

/** Marks a route as public — exempt from API-key authentication. */
export const IS_PUBLIC_KEY = 'IS_PUBLIC_KEY';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);