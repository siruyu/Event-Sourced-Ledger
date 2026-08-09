import { Test } from '@nestjs/testing';
import { HealthController } from '@/interfaces/health/health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('should report ok status', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });
});
