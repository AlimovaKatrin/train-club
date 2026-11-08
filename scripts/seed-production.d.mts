export type SeedReport = {
  mode: 'check' | 'apply';
  action: 'seed' | 'seeded' | 'already_loaded';
  sessions: number;
  pendingMigrations?: string[];
  appliedMigrations?: string[];
  nextPosition?: number;
};

export function seedProduction(options: {
  connectionString: string;
  apply?: boolean;
}): Promise<SeedReport>;
