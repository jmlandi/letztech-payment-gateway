import { maskCustomer, maskDocument, maskEmail, maskIp, maskName, maskPhone } from './mask-pii';

describe('mask-pii', () => {
  describe('maskDocument', () => {
    it('reveals only the last 2 digits of a CPF', () => {
      expect(maskDocument('123.456.789-01')).toBe('•••••••••01');
    });
    it('returns null for empty/invalid input', () => {
      expect(maskDocument('')).toBeNull();
      expect(maskDocument(undefined)).toBeNull();
      expect(maskDocument(12345 as unknown)).toBeNull();
    });
    it('never leaks more than the revealed tail', () => {
      const masked = maskDocument('98765432100')!;
      expect(masked.endsWith('00')).toBe(true);
      expect(masked).not.toContain('987');
    });
  });

  describe('maskPhone', () => {
    it('reveals only the last 4 digits', () => {
      expect(maskPhone('+55 11 98888-1234')).toBe('•••••••••1234');
    });
  });

  describe('maskEmail', () => {
    it('reveals first char of local part and the domain', () => {
      expect(maskEmail('joaomarcos@gmail.com')).toBe('j•••••••••@gmail.com');
    });
    it('returns null when there is no @', () => {
      expect(maskEmail('not-an-email')).toBeNull();
    });
  });

  describe('maskIp', () => {
    it('keeps only the first octet of an IPv4', () => {
      expect(maskIp('189.45.12.9')).toBe('189.•.•.•');
    });
    it('keeps only the first segment of an IPv6', () => {
      expect(maskIp('2804:14c:5b:8f::1')).toBe('2804:••');
    });
  });

  describe('maskName', () => {
    it('reveals the first token and masks the rest', () => {
      expect(maskName('João Marcos Silva')).toBe('João M••••• S••••');
    });
  });

  describe('maskCustomer', () => {
    it('masks all known identity keys and never returns raw values', () => {
      const masked = maskCustomer({
        name: 'João Marcos Silva',
        document: '123.456.789-01',
        email: 'joaomarcos@gmail.com',
        phone: '11988881234',
        ip: '189.45.12.9',
      });
      expect(masked.document).not.toContain('123');
      expect(masked.email).not.toContain('joaomarcos');
      expect(masked.ip).toBe('189.•.•.•');
    });
    it('tolerates missing/unknown shapes without throwing', () => {
      expect(() => maskCustomer(null)).not.toThrow();
      expect(maskCustomer({}).name).toBeNull();
      expect(maskCustomer({ cpf: '11122233344' }).document).toBe('•••••••••44');
    });
  });
});
