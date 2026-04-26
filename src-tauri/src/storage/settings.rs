use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const DEFAULT_PROVIDER: &str = "local";
const DEFAULT_REFRESH_MINUTES: i64 = 0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub embedding_provider: String,
    pub gemini_api_key: Option<String>,
    pub index_refresh_minutes: i64,
    pub embedding_model_version: Option<String>,
    pub show_score_breakdown: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            embedding_provider: DEFAULT_PROVIDER.to_string(),
            gemini_api_key: None,
            index_refresh_minutes: DEFAULT_REFRESH_MINUTES,
            embedding_model_version: None,
            show_score_breakdown: false,
        }
    }
}

pub fn load_settings(conn: &Connection) -> Result<AppSettings> {
    let mut settings = AppSettings::default();

    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        Ok((key, value))
    })?;

    for row in rows {
        let (key, value) = row?;
        match key.as_str() {
            "embedding_provider" => settings.embedding_provider = value,
            "gemini_api_key" => settings.gemini_api_key = Some(value),
            "index_refresh_minutes" => {
                settings.index_refresh_minutes = value.parse().unwrap_or(DEFAULT_REFRESH_MINUTES);
            }
            "embedding_model_version" => settings.embedding_model_version = Some(value),
            "show_score_breakdown" => {
                settings.show_score_breakdown = value == "true" || value == "1";
            }
            _ => {}
        }
    }

    Ok(settings)
}

pub fn save_settings(conn: &Connection, settings: &AppSettings) -> Result<()> {
    let pairs: Vec<(&str, Option<String>)> = vec![
        (
            "embedding_provider",
            Some(settings.embedding_provider.clone()),
        ),
        ("gemini_api_key", settings.gemini_api_key.clone()),
        (
            "index_refresh_minutes",
            Some(settings.index_refresh_minutes.to_string()),
        ),
        (
            "embedding_model_version",
            settings.embedding_model_version.clone(),
        ),
        (
            "show_score_breakdown",
            Some(settings.show_score_breakdown.to_string()),
        ),
    ];

    for (key, value) in pairs {
        match value {
            Some(v) => {
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![key, v],
                )?;
            }
            None => {
                conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
            }
        }
    }

    Ok(())
}

pub fn reset_all_semantic_status(conn: &Connection) -> Result<usize> {
    let count = conn.execute(
        "UPDATE file_semantic_index SET status = 'pending', error_message = NULL",
        [],
    )?;
    Ok(count)
}
