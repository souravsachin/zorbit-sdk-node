import { DynamicModule, Module, Provider } from '@nestjs/common';
import { IntegrationRunnerService, IntegrationRunnerDeps } from './integration-runner.service';

export const INTEGRATION_RUNNER_DEPS = 'INTEGRATION_RUNNER_DEPS';

/**
 * NestJS module wrapper for the framework-agnostic IntegrationRunnerService.
 *
 * Usage:
 *
 *   IntegrationRunnerModule.registerAsync({
 *     imports: [AdapterModule, StoreModule],
 *     inject: [AdapterStore, [RpaExecutor]],
 *     useFactory: (store, executors) => ({ store, executors })
 *   })
 */
@Module({})
export class IntegrationRunnerModule {
  static register(deps: IntegrationRunnerDeps): DynamicModule {
    const runnerProvider: Provider = {
      provide: IntegrationRunnerService,
      useFactory: () => new IntegrationRunnerService(deps),
    };
    return {
      module: IntegrationRunnerModule,
      providers: [runnerProvider],
      exports: [IntegrationRunnerService],
    };
  }

  static registerAsync(options: {
    imports?: any[];
    inject?: any[];
    useFactory: (...args: any[]) => IntegrationRunnerDeps | Promise<IntegrationRunnerDeps>;
  }): DynamicModule {
    const runnerProvider: Provider = {
      provide: IntegrationRunnerService,
      useFactory: async (...args: any[]) => {
        const deps = await options.useFactory(...args);
        return new IntegrationRunnerService(deps);
      },
      inject: options.inject ?? [],
    };
    return {
      module: IntegrationRunnerModule,
      imports: options.imports ?? [],
      providers: [runnerProvider],
      exports: [IntegrationRunnerService],
    };
  }
}
