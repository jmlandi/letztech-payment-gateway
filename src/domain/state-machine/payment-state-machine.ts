import { UnprocessableEntityException } from '@nestjs/common';
import { ALLOWED_TRANSITIONS, PaymentStatus } from './allowed-transitions';

export class PaymentStateMachine {
  static validate(from: PaymentStatus, to: PaymentStatus): void {
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'invalid_state_transition',
          message: `Cannot transition payment from '${from}' to '${to}'`,
        },
      });
    }
  }

  static canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  static isTerminal(status: PaymentStatus): boolean {
    return ALLOWED_TRANSITIONS[status].length === 0;
  }
}
