import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './interfaces/health/health.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true }), HealthModule],
})
export class AppModule {}
