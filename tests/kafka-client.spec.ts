import { ZorbitKafkaClient } from '../src/kafka/kafka-client';

// Mock kafkajs
const mockSend = jest.fn().mockResolvedValue(undefined);
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockSubscribe = jest.fn().mockResolvedValue(undefined);
const mockRun = jest.fn().mockResolvedValue(undefined);

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: () => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      send: mockSend,
    }),
    consumer: () => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      subscribe: mockSubscribe,
      run: mockRun,
    }),
  })),
  logLevel: { WARN: 5 },
}));

describe('ZorbitKafkaClient', () => {
  let client: ZorbitKafkaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ZorbitKafkaClient({
      brokers: ['localhost:9092'],
      clientId: 'test-service',
      groupId: 'test-group',
    });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  describe('publish', () => {
    it('should throw if producer is not connected', async () => {
      await expect(
        client.publish('test-topic', 'test.event.created', { type: 'O', id: 'O-92AF' }, { type: 'user', id: 'U-81F3' }, { foo: 'bar' }),
      ).rejects.toThrow('Producer not connected');
    });

    it('should publish event with canonical envelope', async () => {
      await client.connectProducer();

      const event = await client.publish(
        'test-topic',
        'identity.user.created',
        { type: 'O', id: 'O-92AF' },
        { type: 'user', id: 'U-81F3' },
        { name: 'Test User' },
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sendCall = mockSend.mock.calls[0][0];
      expect(sendCall.topic).toBe('test-topic');

      const message = sendCall.messages[0];
      expect(message.key).toBe(event.eventId);

      const body = JSON.parse(message.value);
      expect(body.eventType).toBe('identity.user.created');
      expect(body.source).toBe('test-service');
      expect(body.namespace).toEqual({ type: 'O', id: 'O-92AF' });
      expect(body.actor).toEqual({ type: 'user', id: 'U-81F3' });
      expect(body.data).toEqual({ name: 'Test User' });
      expect(body.eventId).toMatch(/^EV-[0-9A-F]{4}$/);
      expect(body.timestamp).toBeDefined();
    });

    it('should return the created event', async () => {
      await client.connectProducer();

      const event = await client.publish(
        'test-topic',
        'test.entity.updated',
        { type: 'G', id: 'G-0000' },
        { type: 'system', id: 'SYS' },
        { updated: true },
        { traceId: 'abc123' },
      );

      expect(event.eventId).toMatch(/^EV-[0-9A-F]{4}$/);
      expect(event.eventType).toBe('test.entity.updated');
      expect(event.metadata).toEqual({ traceId: 'abc123' });
    });
  });

  describe('subscribe', () => {
    it('should throw if consumer is not connected', async () => {
      await expect(
        client.subscribe('test-topic', async () => {}),
      ).rejects.toThrow('Consumer not connected');
    });

    it('should subscribe to topic and register handler', async () => {
      await client.connectConsumer();

      const handler = jest.fn();
      await client.subscribe('test-topic', handler);

      expect(mockSubscribe).toHaveBeenCalledWith({
        topic: 'test-topic',
        fromBeginning: false,
      });
      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });

  describe('consumer creation', () => {
    it('should throw if groupId is not configured', async () => {
      const noGroupClient = new ZorbitKafkaClient({
        brokers: ['localhost:9092'],
        clientId: 'test-service',
      });

      await expect(noGroupClient.connectConsumer()).rejects.toThrow('groupId is required');
    });
  });
});
