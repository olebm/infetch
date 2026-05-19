/**
 * Zentrale Stammdaten für die Rechtsseiten (Impressum, Datenschutz, AGB, AVV).
 *
 * Eine einzige Quelle der Wahrheit für das "Stand"-Datum — vorher war es 4×
 * hartkodiert und bereits auseinandergelaufen (AGB stand auf "14. Mai 2025",
 * Rest auf 2026). Bei inhaltlicher Änderung einer Rechtsseite hier das Datum
 * (und ggf. AVV_VERSION) hochsetzen.
 */
export const LEGAL_STAND = "19. Mai 2026";

/** Version des AVV-Vertragstexts (Click-through-Nachweis). */
export const AVV_VERSION = "1.1";
