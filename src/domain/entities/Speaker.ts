// Domain entity describing a meeting participant or inferred speaker channel.
export interface Speaker {
  id: string;
  label: string;
  preferredLanguage?: string;
  isActive: boolean;
}
