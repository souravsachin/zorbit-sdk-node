import { detectPII, BUILTIN_PATTERNS, createPIIDetector, PIIPattern } from '../src/interceptors/pii-detector';

describe('PII Detector', () => {
  describe('detectPII - field name patterns', () => {
    it('should detect email fields', () => {
      const data = { email: 'john@example.com', status: 'active' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.length).toBeGreaterThanOrEqual(1);
      expect(detections.some(d => d.field === 'email' && d.piiType === 'email')).toBe(true);
    });

    it('should detect phone fields', () => {
      const data = { phone: '+1234567890', mobileNumber: '9876543210' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.field === 'phone')).toBe(true);
      expect(detections.some(d => d.field === 'mobileNumber')).toBe(true);
    });

    it('should detect name fields', () => {
      const data = { firstName: 'John', lastName: 'Doe', displayName: 'JD' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.field === 'firstName' && d.piiType === 'name')).toBe(true);
      expect(detections.some(d => d.field === 'lastName' && d.piiType === 'name')).toBe(true);
      expect(detections.some(d => d.field === 'displayName' && d.piiType === 'name')).toBe(true);
    });

    it('should detect national ID fields', () => {
      const data = { ssn: '123-45-6789', aadhaar: '1234 5678 9012', passportNumber: 'AB123456' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.field === 'ssn' && d.piiType === 'national_id')).toBe(true);
      expect(detections.some(d => d.field === 'aadhaar' && d.piiType === 'national_id')).toBe(true);
    });

    it('should detect address fields', () => {
      const data = { address: '123 Main St', postalCode: '10001', city: 'NYC' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.field === 'address' && d.piiType === 'address')).toBe(true);
      expect(detections.some(d => d.field === 'postalCode' && d.piiType === 'address')).toBe(true);
      expect(detections.some(d => d.field === 'city' && d.piiType === 'address')).toBe(true);
    });

    it('should detect date of birth fields', () => {
      const data = { dateOfBirth: '1990-01-01', dob: '01/01/1990' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.field === 'dateOfBirth' && d.piiType === 'dob')).toBe(true);
      expect(detections.some(d => d.field === 'dob' && d.piiType === 'dob')).toBe(true);
    });

    it('should detect financial fields', () => {
      const data = { bankAccount: '123456789', iban: 'GB82WEST12345698765432' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.field === 'bankAccount' && d.piiType === 'financial')).toBe(true);
      expect(detections.some(d => d.field === 'iban' && d.piiType === 'financial')).toBe(true);
    });
  });

  describe('detectPII - value patterns', () => {
    it('should detect email values in non-email-named fields', () => {
      const data = { contactInfo: 'test@example.com' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.piiType === 'email')).toBe(true);
    });

    it('should detect SSN format values', () => {
      const data = { identifier: '123-45-6789' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.piiType === 'national_id')).toBe(true);
    });

    it('should detect Aadhaar format values', () => {
      const data = { govId: '1234 5678 9012' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.piiType === 'national_id')).toBe(true);
    });
  });

  describe('detectPII - nested objects', () => {
    it('should detect PII in nested objects', () => {
      const data = {
        profile: {
          email: 'nested@example.com',
          address: '456 Oak Ave',
        },
        status: 'active',
      };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.some(d => d.field === 'profile.email')).toBe(true);
      expect(detections.some(d => d.field === 'profile.address')).toBe(true);
    });
  });

  describe('detectPII - skip fields', () => {
    it('should skip explicitly listed fields', () => {
      const data = { email: 'test@example.com', phone: '+1234567890' };
      const detections = detectPII(data, BUILTIN_PATTERNS, ['email']);
      expect(detections.some(d => d.field === 'email')).toBe(false);
      expect(detections.some(d => d.field === 'phone')).toBe(true);
    });
  });

  describe('detectPII - existing tokens', () => {
    it('should skip values that look like PII tokens', () => {
      const data = { email: 'PII-A1B2', firstName: 'PII-C3D4' };
      const detections = detectPII(data, BUILTIN_PATTERNS);
      expect(detections.length).toBe(0);
    });
  });

  describe('detectPII - non-string values', () => {
    it('should ignore numeric and boolean values', () => {
      const data = { phone: 12345, email: true, status: 'active' };
      const detections = detectPII(data as Record<string, unknown>, BUILTIN_PATTERNS);
      // phone and email are non-string, should be ignored
      expect(detections.some(d => d.field === 'phone')).toBe(false);
      expect(detections.some(d => d.field === 'email')).toBe(false);
    });
  });

  describe('detectPII - custom patterns', () => {
    it('should match additional patterns', () => {
      const customPatterns: PIIPattern[] = [
        { fieldPattern: /customField/i, piiType: 'custom' },
      ];
      const allPatterns = [...BUILTIN_PATTERNS, ...customPatterns];
      const data = { customField: 'some sensitive data' };
      const detections = detectPII(data, allPatterns);
      expect(detections.some(d => d.field === 'customField' && d.piiType === 'custom')).toBe(true);
    });
  });

  describe('createPIIDetector', () => {
    it('should return data unchanged when disabled', async () => {
      const detector = createPIIDetector({
        piiVaultUrl: 'http://localhost:3105',
        orgHashId: 'O-92AF',
        enabled: false,
      });

      const data = { email: 'test@example.com' };
      const result = await detector(data);
      expect(result.data.email).toBe('test@example.com');
      expect(result.detections.length).toBe(0);
    });

    it('should detect PII and replace with tokens when enabled (vault unreachable)', async () => {
      const detector = createPIIDetector({
        piiVaultUrl: 'http://localhost:99999', // unreachable
        orgHashId: 'O-92AF',
        enabled: true,
      });

      const data = { email: 'test@example.com', status: 'active' };
      const result = await detector(data);
      // email should be replaced with a placeholder token
      expect(result.data.email).not.toBe('test@example.com');
      expect(result.data.email).toMatch(/^PII-/);
      // status should be unchanged
      expect(result.data.status).toBe('active');
      expect(result.detections.length).toBeGreaterThanOrEqual(1);
    });

    it('should not mutate the original object', async () => {
      const detector = createPIIDetector({
        piiVaultUrl: 'http://localhost:99999',
        orgHashId: 'O-92AF',
        enabled: true,
      });

      const data = { email: 'test@example.com' };
      await detector(data);
      expect(data.email).toBe('test@example.com');
    });
  });
});
