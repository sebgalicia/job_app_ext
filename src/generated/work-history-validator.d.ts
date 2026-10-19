export declare const validate: {
  (data: unknown): boolean;
  errors?: Array<{
    instancePath: string;
    keyword: string;
    message?: string;
    params: Record<string, string>;
  }> | null;
};
