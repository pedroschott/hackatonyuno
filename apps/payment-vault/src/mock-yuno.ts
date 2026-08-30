import { createHash } from 'node:crypto';

export type MockGatewayId = 'card-gateway-a' | 'card-gateway-b';
export type MockGatewayScenario =
  | 'approved'
  | 'declined'
  | 'authorization_timeout'
  | 'capture_failed';

export type MockYunoAuthorizeInput = {
  authorizationId: string;
  operationId: string;
  providerTokenRef: string;
  amountMinor: number;
  currency: string;
  merchantReference: string;
  idempotencyKey: string;
};

export type MockYunoAuthorizationResult = {
  outcome: 'authorized' | 'declined' | 'reconciliation_required';
  gatewayId: MockGatewayId;
  reasonCode?: string;
};

export type MockYunoStatusResult = {
  outcome: 'authorized' | 'declined' | 'captured' | 'voided' | 'unknown';
  gatewayId: MockGatewayId;
  reasonCode?: string;
};

export type MockYunoCaptureResult = {
  outcome: 'captured' | 'failed' | 'reconciliation_required';
  gatewayId: MockGatewayId;
  reasonCode?: string;
};

export type MockYunoVoidResult = {
  outcome: 'voided' | 'failed' | 'reconciliation_required';
  gatewayId: MockGatewayId;
  reasonCode?: string;
};

export interface MockYunoRouter {
  authorize(input: MockYunoAuthorizeInput): Promise<MockYunoAuthorizationResult>;
  getAuthorizationStatus(input: {
    authorizationId: string;
    operationId: string;
  }): Promise<MockYunoStatusResult>;
  capture(input: {
    authorizationId: string;
    operationId: string;
    idempotencyKey: string;
  }): Promise<MockYunoCaptureResult>;
  void(input: {
    authorizationId: string;
    operationId: string;
    idempotencyKey: string;
  }): Promise<MockYunoVoidResult>;
}

/** Test hook for proving the Vault's local capture/void state transition. */
export type MockYunoRouterOptions = {
  beforeCapture?: (input: {
    authorizationId: string;
    operationId: string;
    idempotencyKey: string;
  }) => Promise<void>;
};

export interface MockPaymentScenarioResolver {
  resolve(input: {
    authorizationId: string;
    operationId: string;
    merchantReference: string;
  }): Promise<MockGatewayScenario>;
}

/**
 * Demo-only scenario control. The request surface never selects a scenario;
 * an operator or test configures this adapter before an operation begins.
 */
export class InMemoryMockPaymentScenarioResolver implements MockPaymentScenarioResolver {
  private readonly scenarios = new Map<string, MockGatewayScenario>();

  constructor(
    private readonly defaultScenario: MockGatewayScenario = 'approved',
    scenarios: ReadonlyMap<string, MockGatewayScenario> = new Map(),
  ) {
    for (const [operationId, scenario] of scenarios) {
      this.scenarios.set(operationId, scenario);
    }
  }

  setScenario(operationId: string, scenario: MockGatewayScenario): void {
    this.scenarios.set(operationId, scenario);
  }

  async resolve(input: {
    authorizationId: string;
    operationId: string;
    merchantReference: string;
  }): Promise<MockGatewayScenario> {
    return this.scenarios.get(input.operationId) ?? this.defaultScenario;
  }
}

type GatewayAuthorizationStatus = 'authorized' | 'declined' | 'unknown' | 'captured' | 'voided';

type GatewayAuthorization = {
  authorizationId: string;
  operationId: string;
  providerTokenRef: string;
  amountMinor: number;
  currency: string;
  merchantReference: string;
  scenario: MockGatewayScenario;
  status: GatewayAuthorizationStatus;
};

interface MockCardGateway {
  readonly id: MockGatewayId;
  authorize(input: MockYunoAuthorizeInput, scenario: MockGatewayScenario): Promise<MockYunoAuthorizationResult>;
  getStatus(authorizationId: string): Promise<MockYunoStatusResult>;
  capture(authorizationId: string): Promise<MockYunoCaptureResult>;
  void(authorizationId: string): Promise<MockYunoVoidResult>;
}

export class DeterministicMockYunoRouter implements MockYunoRouter {
  private readonly gateways: ReadonlyMap<MockGatewayId, MockCardGateway>;

  constructor(
    private readonly scenarioResolver: MockPaymentScenarioResolver,
    gatewayA: MockCardGateway = new InMemoryMockCardGateway('card-gateway-a'),
    gatewayB: MockCardGateway = new InMemoryMockCardGateway('card-gateway-b'),
    private readonly options: MockYunoRouterOptions = {},
  ) {
    this.gateways = new Map([
      [gatewayA.id, gatewayA],
      [gatewayB.id, gatewayB],
    ]);
  }

  async authorize(input: MockYunoAuthorizeInput): Promise<MockYunoAuthorizationResult> {
    const gateway = this.gatewayForOperation(input.operationId);
    const scenario = await this.scenarioResolver.resolve({
      authorizationId: input.authorizationId,
      operationId: input.operationId,
      merchantReference: input.merchantReference,
    });
    return gateway.authorize(input, scenario);
  }

  async getAuthorizationStatus(input: {
    authorizationId: string;
    operationId: string;
  }): Promise<MockYunoStatusResult> {
    return this.gatewayForOperation(input.operationId).getStatus(input.authorizationId);
  }

  async capture(input: {
    authorizationId: string;
    operationId: string;
    idempotencyKey: string;
  }): Promise<MockYunoCaptureResult> {
    await this.options.beforeCapture?.(input);
    return this.gatewayForOperation(input.operationId).capture(input.authorizationId);
  }

  async void(input: {
    authorizationId: string;
    operationId: string;
    idempotencyKey: string;
  }): Promise<MockYunoVoidResult> {
    return this.gatewayForOperation(input.operationId).void(input.authorizationId);
  }

  routeForOperation(operationId: string): MockGatewayId {
    return gatewayIdForOperation(operationId);
  }

  private gatewayForOperation(operationId: string): MockCardGateway {
    const gateway = this.gateways.get(gatewayIdForOperation(operationId));
    if (!gateway) {
      throw new Error('A configured Mock Yuno gateway is unavailable.');
    }
    return gateway;
  }
}

class InMemoryMockCardGateway implements MockCardGateway {
  private readonly authorizations = new Map<string, GatewayAuthorization>();

  constructor(readonly id: MockGatewayId) {}

  async authorize(
    input: MockYunoAuthorizeInput,
    scenario: MockGatewayScenario,
  ): Promise<MockYunoAuthorizationResult> {
    const existing = this.authorizations.get(input.authorizationId);
    if (existing) {
      return resultForGatewayAuthorization(existing, this.id);
    }

    const authorization: GatewayAuthorization = {
      authorizationId: input.authorizationId,
      operationId: input.operationId,
      providerTokenRef: input.providerTokenRef,
      amountMinor: input.amountMinor,
      currency: input.currency,
      merchantReference: input.merchantReference,
      scenario,
      status: statusForScenario(scenario),
    };
    this.authorizations.set(input.authorizationId, authorization);
    return resultForGatewayAuthorization(authorization, this.id);
  }

  async getStatus(authorizationId: string): Promise<MockYunoStatusResult> {
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) {
      return { outcome: 'unknown', gatewayId: this.id, reasonCode: 'GATEWAY_AUTHORIZATION_UNKNOWN' };
    }

    if (authorization.status === 'unknown') {
      authorization.status = 'authorized';
    }

    return statusForGatewayAuthorization(authorization, this.id);
  }

  async capture(authorizationId: string): Promise<MockYunoCaptureResult> {
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) {
      return {
        outcome: 'reconciliation_required',
        gatewayId: this.id,
        reasonCode: 'GATEWAY_AUTHORIZATION_UNKNOWN',
      };
    }

    if (authorization.status === 'unknown') {
      return {
        outcome: 'reconciliation_required',
        gatewayId: this.id,
        reasonCode: 'AUTHORIZATION_STATUS_UNKNOWN',
      };
    }
    if (authorization.status === 'captured') {
      return { outcome: 'captured', gatewayId: this.id };
    }
    if (authorization.status === 'voided' || authorization.status === 'declined') {
      return {
        outcome: 'failed',
        gatewayId: this.id,
        reasonCode: 'AUTHORIZATION_NOT_CAPTURABLE',
      };
    }
    if (authorization.scenario === 'capture_failed') {
      return {
        outcome: 'failed',
        gatewayId: this.id,
        reasonCode: 'CAPTURE_FAILED',
      };
    }

    authorization.status = 'captured';
    return { outcome: 'captured', gatewayId: this.id };
  }

  async void(authorizationId: string): Promise<MockYunoVoidResult> {
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) {
      return {
        outcome: 'reconciliation_required',
        gatewayId: this.id,
        reasonCode: 'GATEWAY_AUTHORIZATION_UNKNOWN',
      };
    }
    if (authorization.status === 'captured') {
      return {
        outcome: 'failed',
        gatewayId: this.id,
        reasonCode: 'CAPTURE_ALREADY_FINAL',
      };
    }

    authorization.status = 'voided';
    return { outcome: 'voided', gatewayId: this.id };
  }
}

function gatewayIdForOperation(operationId: string): MockGatewayId {
  const firstByte = createHash('sha256').update(operationId).digest()[0] ?? 0;
  return firstByte % 2 === 0 ? 'card-gateway-a' : 'card-gateway-b';
}

function statusForScenario(scenario: MockGatewayScenario): GatewayAuthorizationStatus {
  switch (scenario) {
    case 'approved':
    case 'capture_failed':
      return 'authorized';
    case 'declined':
      return 'declined';
    case 'authorization_timeout':
      return 'unknown';
  }
}

function resultForGatewayAuthorization(
  authorization: GatewayAuthorization,
  gatewayId: MockGatewayId,
): MockYunoAuthorizationResult {
  switch (authorization.status) {
    case 'authorized':
      return { outcome: 'authorized', gatewayId };
    case 'declined':
      return { outcome: 'declined', gatewayId, reasonCode: 'GATEWAY_DECLINED' };
    case 'unknown':
      return {
        outcome: 'reconciliation_required',
        gatewayId,
        reasonCode: 'AUTHORIZATION_STATUS_UNKNOWN',
      };
    case 'captured':
      return { outcome: 'authorized', gatewayId };
    case 'voided':
      return { outcome: 'declined', gatewayId, reasonCode: 'AUTHORIZATION_VOIDED' };
  }
}

function statusForGatewayAuthorization(
  authorization: GatewayAuthorization,
  gatewayId: MockGatewayId,
): MockYunoStatusResult {
  switch (authorization.status) {
    case 'authorized':
      return { outcome: 'authorized', gatewayId };
    case 'declined':
      return { outcome: 'declined', gatewayId, reasonCode: 'GATEWAY_DECLINED' };
    case 'captured':
      return { outcome: 'captured', gatewayId };
    case 'voided':
      return { outcome: 'voided', gatewayId };
    case 'unknown':
      return { outcome: 'unknown', gatewayId, reasonCode: 'AUTHORIZATION_STATUS_UNKNOWN' };
  }
}
