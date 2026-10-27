import { z } from 'zod';

export const weatherLocationSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type WeatherLocation = z.infer<typeof weatherLocationSchema>;
export interface WeatherConditions {
  temperature: number; apparentTemperature: number; humidity: number; windSpeed: number;
  code: number; isDay: boolean; low: number; high: number; observedAt: number; fetchedAt: number;
}
