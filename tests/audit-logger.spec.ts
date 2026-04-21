import { computeChanges, buildAuditEvent } from '../src/interceptors/audit-logger';

describe('Audit Logger', () => {
  describe('computeChanges', () => {
    it('should detect all fields as new when oldObj is null (create)', () => {
      const newObj = { name: 'John', status: 'active', count: 5 };
      const changes = computeChanges(null, newObj);
      expect(changes.length).toBe(3);
      expect(changes.find(c => c.field === 'name')).toEqual({
        field: 'name', oldValue: null, newValue: 'John',
      });
      expect(changes.find(c => c.field === 'status')).toEqual({
        field: 'status', oldValue: null, newValue: 'active',
      });
      expect(changes.find(c => c.field === 'count')).toEqual({
        field: 'count', oldValue: null, newValue: 5,
      });
    });

    it('should detect modified fields', () => {
      const oldObj = { name: 'John', status: 'active' };
      const newObj = { name: 'John', status: 'inactive' };
      const changes = computeChanges(oldObj, newObj);
      expect(changes.length).toBe(1);
      expect(changes[0]).toEqual({
        field: 'status', oldValue: 'active', newValue: 'inactive',
      });
    });

    it('should detect added fields', () => {
      const oldObj = { name: 'John' };
      const newObj = { name: 'John', status: 'active' };
      const changes = computeChanges(oldObj, newObj);
      expect(changes.length).toBe(1);
      expect(changes[0]).toEqual({
        field: 'status', oldValue: null, newValue: 'active',
      });
    });

    it('should detect removed fields', () => {
      const oldObj = { name: 'John', status: 'active' };
      const newObj = { name: 'John' };
      const changes = computeChanges(oldObj, newObj);
      expect(changes.length).toBe(1);
      expect(changes[0]).toEqual({
        field: 'status', oldValue: 'active', newValue: null,
      });
    });

    it('should return empty array when objects are identical', () => {
      const oldObj = { name: 'John', status: 'active' };
      const newObj = { name: 'John', status: 'active' };
      const changes = computeChanges(oldObj, newObj);
      expect(changes.length).toBe(0);
    });

    it('should compare nested objects by JSON serialization', () => {
      const oldObj = { profile: { age: 30 } };
      const newObj = { profile: { age: 31 } };
      const changes = computeChanges(oldObj, newObj);
      expect(changes.length).toBe(1);
      expect(changes[0].field).toBe('profile');
    });

    it('should handle empty objects', () => {
      const changes = computeChanges({}, {});
      expect(changes.length).toBe(0);
    });
  });

  describe('buildAuditEvent', () => {
    it('should create a valid audit event for create', () => {
      const event = buildAuditEvent(
        'create',
        'sample-customer-service',
        'customer',
        'CUST-A1B2',
        'O-92AF',
        'U-81F3',
        [{ field: 'name', oldValue: null, newValue: 'John' }],
        '10.0.0.1',
      );

      expect(event.eventId).toMatch(/^AUD-[0-9A-F]{4}$/);
      expect(event.eventType).toBe('create');
      expect(event.serviceName).toBe('sample-customer-service');
      expect(event.entityType).toBe('customer');
      expect(event.entityId).toBe('CUST-A1B2');
      expect(event.organizationHashId).toBe('O-92AF');
      expect(event.userHashId).toBe('U-81F3');
      expect(event.changes.length).toBe(1);
      expect(event.ipAddress).toBe('10.0.0.1');
      expect(event.timestamp).toBeDefined();
    });

    it('should create a valid audit event for update', () => {
      const event = buildAuditEvent(
        'update',
        'my-service',
        'order',
        'ORD-1234',
        'O-AAAA',
        'U-BBBB',
        [{ field: 'status', oldValue: 'pending', newValue: 'approved' }],
      );

      expect(event.eventType).toBe('update');
      expect(event.ipAddress).toBeUndefined();
    });

    it('should create a valid audit event for delete', () => {
      const event = buildAuditEvent(
        'delete',
        'my-service',
        'record',
        'REC-5678',
        'O-CCCC',
        'U-DDDD',
        [{ field: 'name', oldValue: 'Old Name', newValue: null }],
      );

      expect(event.eventType).toBe('delete');
      expect(event.changes[0].newValue).toBeNull();
    });

    it('should generate unique event IDs', () => {
      const event1 = buildAuditEvent('create', 's', 'e', 'id1', 'O-1', 'U-1', []);
      const event2 = buildAuditEvent('create', 's', 'e', 'id2', 'O-1', 'U-1', []);
      expect(event1.eventId).not.toBe(event2.eventId);
    });
  });
});
