import axios, { AxiosInstance } from 'axios';

/**
 * Configuration for the Form Builder client.
 */
export interface FormBuilderClientConfig {
  /** Form Builder service URL (e.g. http://localhost:3114) */
  formBuilderUrl: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

/**
 * A form template definition as returned by the form builder service.
 */
export interface FormTemplate {
  _id: string;
  hashId: string;
  name: string;
  slug: string;
  description?: string;
  schema: Record<string, unknown>;
  organizationHashId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A form submission record.
 */
export interface FormSubmission {
  _id: string;
  hashId: string;
  formHashId: string;
  data: Record<string, unknown>;
  status: string;
  organizationHashId: string;
  submittedBy: string;
  createdAt: string;
}

/**
 * High-level client for the Zorbit Form Builder service.
 *
 * Provides methods to list forms, get form schemas, and submit form data.
 *
 * @example
 * ```typescript
 * import { FormBuilderClient } from '@zorbit-platform/sdk-node';
 *
 * const forms = new FormBuilderClient({
 *   formBuilderUrl: 'http://localhost:3114',
 * });
 *
 * // List forms for an org
 * const templates = await forms.listForms('O-92AF', jwtToken);
 *
 * // Get form schema
 * const schema = await forms.getForm('FRM-A1B2', 'O-92AF', jwtToken);
 *
 * // Submit form data
 * await forms.submitForm('FRM-A1B2', formData, 'O-92AF', jwtToken);
 *
 * // Get submissions
 * const subs = await forms.getSubmissions('FRM-A1B2', 'O-92AF', jwtToken);
 * ```
 */
export class FormBuilderClient {
  private client: AxiosInstance;

  constructor(config: FormBuilderClientConfig) {
    this.client = axios.create({
      baseURL: config.formBuilderUrl,
      timeout: config.timeout ?? 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * List all form templates for an organization.
   */
  async listForms(orgHashId: string, authToken: string): Promise<FormTemplate[]> {
    const res = await this.client.get(
      `/api/v1/O/${orgHashId}/forms`,
      { headers: this.authHeaders(authToken) },
    );
    return res.data?.data ?? res.data;
  }

  /**
   * Get a single form template by hash ID.
   */
  async getForm(formHashId: string, orgHashId: string, authToken: string): Promise<FormTemplate> {
    const res = await this.client.get(
      `/api/v1/O/${orgHashId}/forms/${formHashId}`,
      { headers: this.authHeaders(authToken) },
    );
    return res.data?.data ?? res.data;
  }

  /**
   * Create a new form template.
   */
  async createForm(
    data: { name: string; slug: string; description?: string; schema: Record<string, unknown> },
    orgHashId: string,
    authToken: string,
  ): Promise<FormTemplate> {
    const res = await this.client.post(
      `/api/v1/O/${orgHashId}/forms`,
      data,
      { headers: this.authHeaders(authToken) },
    );
    return res.data?.data ?? res.data;
  }

  /**
   * Submit data to a form.
   */
  async submitForm(
    formHashId: string,
    formData: Record<string, unknown>,
    orgHashId: string,
    authToken: string,
  ): Promise<FormSubmission> {
    const res = await this.client.post(
      `/api/v1/O/${orgHashId}/forms/${formHashId}/submissions`,
      { data: formData },
      { headers: this.authHeaders(authToken) },
    );
    return res.data?.data ?? res.data;
  }

  /**
   * Get submissions for a form.
   */
  async getSubmissions(
    formHashId: string,
    orgHashId: string,
    authToken: string,
    params?: { page?: number; pageSize?: number },
  ): Promise<{ data: FormSubmission[]; total: number }> {
    const res = await this.client.get(
      `/api/v1/O/${orgHashId}/forms/${formHashId}/submissions`,
      { headers: this.authHeaders(authToken), params },
    );
    return res.data;
  }
}
