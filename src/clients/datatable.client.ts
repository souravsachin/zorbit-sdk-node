import axios, { AxiosInstance } from 'axios';

/**
 * Configuration for the DataTable client.
 */
export interface DataTableClientConfig {
  /** DataTable service URL (e.g. http://localhost:3113) */
  dataTableUrl: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

/**
 * A DataTable page configuration.
 */
export interface DataTablePageConfig {
  _id?: string;
  hashId: string;
  shortname: string;
  title: string;
  description?: string;
  columns: DataTableColumn[];
  dataSource: DataTableDataSource;
  organizationHashId: string;
  filters?: DataTableFilterDef[];
  defaultSort?: { field: string; direction: 'asc' | 'desc' };
  pageSize?: number;
}

/**
 * A column definition within a DataTable page.
 */
export interface DataTableColumn {
  field: string;
  header: string;
  type?: 'text' | 'number' | 'date' | 'currency' | 'status' | 'pii' | 'boolean';
  sortable?: boolean;
  filterable?: boolean;
  visible?: boolean;
  width?: string;
  piiType?: string;
  format?: string;
}

/**
 * Data source configuration for a DataTable.
 */
export interface DataTableDataSource {
  /** Type of data source */
  type: 'api' | 'collection';
  /** API endpoint or collection name */
  endpoint: string;
  /** HTTP method for API sources (default: GET) */
  method?: string;
}

/**
 * Filter definition for a DataTable.
 */
export interface DataTableFilterDef {
  field: string;
  label: string;
  type: 'text' | 'select' | 'date-range' | 'number-range' | 'boolean';
  options?: Array<{ label: string; value: string }>;
}

/**
 * Paginated data response.
 */
export interface DataTablePage<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Query parameters for fetching DataTable data.
 */
export interface DataTableQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
  timePreset?: string;
}

/**
 * High-level client for the Zorbit DataTable service.
 *
 * Provides methods to register page configurations, fetch paginated data,
 * and query DataTable definitions.
 *
 * @example
 * ```typescript
 * import { DataTableClient } from '@zorbit-platform/sdk-node';
 *
 * const dt = new DataTableClient({
 *   dataTableUrl: 'http://localhost:3113',
 * });
 *
 * // Register a page configuration
 * await dt.registerPage({
 *   shortname: 'customers',
 *   title: 'Customers',
 *   columns: [
 *     { field: 'name', header: 'Name', type: 'pii', piiType: 'name' },
 *     { field: 'status', header: 'Status', type: 'status' },
 *   ],
 *   dataSource: { type: 'api', endpoint: '/api/v1/O/{orgId}/customers' },
 *   organizationHashId: 'O-92AF',
 * }, 'O-92AF', jwtToken);
 *
 * // Fetch data
 * const page = await dt.getData('customers', 'O-92AF', jwtToken, {
 *   page: 1, pageSize: 25, search: 'john',
 * });
 * ```
 */
export class DataTableClient {
  private client: AxiosInstance;

  constructor(config: DataTableClientConfig) {
    this.client = axios.create({
      baseURL: config.dataTableUrl,
      timeout: config.timeout ?? 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * List all page configurations for an organization.
   */
  async listPages(
    orgHashId: string,
    authToken: string,
  ): Promise<DataTablePageConfig[]> {
    const res = await this.client.get(
      `/api/v1/O/${orgHashId}/pages`,
      { headers: this.authHeaders(authToken) },
    );
    return res.data?.data ?? res.data;
  }

  /**
   * Get a page configuration by shortname.
   */
  async getPage(
    shortname: string,
    orgHashId: string,
    authToken: string,
  ): Promise<DataTablePageConfig> {
    const res = await this.client.get(
      `/api/v1/O/${orgHashId}/pages/${shortname}`,
      { headers: this.authHeaders(authToken) },
    );
    return res.data?.data ?? res.data;
  }

  /**
   * Register (create or update) a page configuration.
   */
  async registerPage(
    config: Omit<DataTablePageConfig, '_id' | 'hashId'> & { hashId?: string },
    orgHashId: string,
    authToken: string,
  ): Promise<DataTablePageConfig> {
    const res = await this.client.post(
      `/api/v1/O/${orgHashId}/pages`,
      config,
      { headers: this.authHeaders(authToken) },
    );
    return res.data?.data ?? res.data;
  }

  /**
   * Fetch paginated data for a DataTable page.
   */
  async getData<T = Record<string, unknown>>(
    shortname: string,
    orgHashId: string,
    authToken: string,
    query?: DataTableQuery,
  ): Promise<DataTablePage<T>> {
    const params: Record<string, unknown> = {};
    if (query) {
      if (query.page) params.page = query.page;
      if (query.pageSize) params.pageSize = query.pageSize;
      if (query.search) params.search = query.search;
      if (query.sortField) params.sortField = query.sortField;
      if (query.sortDirection) params.sortDirection = query.sortDirection;
      if (query.timePreset) params.timePreset = query.timePreset;
      if (query.filters) {
        for (const [key, value] of Object.entries(query.filters)) {
          params[`filter_${key}`] = typeof value === 'object' ? JSON.stringify(value) : value;
        }
      }
    }

    const res = await this.client.get(
      `/api/v1/O/${orgHashId}/pages/${shortname}/data`,
      { headers: this.authHeaders(authToken), params },
    );
    return res.data;
  }

  /**
   * Delete a page configuration.
   */
  async deletePage(
    shortname: string,
    orgHashId: string,
    authToken: string,
  ): Promise<void> {
    await this.client.delete(
      `/api/v1/O/${orgHashId}/pages/${shortname}`,
      { headers: this.authHeaders(authToken) },
    );
  }
}
