import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { verifyOAuthState } from "@/lib/google-drive";

function parseOAuthHash() {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);

  return {
    access_token: params.get("access_token"),
    expires_in: params.get("expires_in"),
    state: params.get("state"),
    error: params.get("error"),
    error_description: params.get("error_description"),
  };
}

const PENDING_TOKEN_KEY = "investpro_gdrive_pending";

export default function GoogleAuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"connecting" | "success" | "error" | "unexpected">(
    "connecting"
  );

  const result = useMemo(() => parseOAuthHash(), []);

  useEffect(() => {
    // Success
    if (result.access_token) {
      // Verify CSRF state if present in URL (required when state was stored before redirect)
      if (result.state !== null && !verifyOAuthState(result.state)) {
        setStatus("error");
        return;
      }

      const expiresIn = Number.parseInt(result.expires_in || "", 10);
      const tokenData = {
        access_token: result.access_token,
        expires_in: Number.isFinite(expiresIn) ? expiresIn : 3600,
        timestamp: Date.now(),
      };

      // Always store as fallback
      sessionStorage.setItem(PENDING_TOKEN_KEY, JSON.stringify(tokenData));

      // Try to notify opener (popup flow)
      try {
        window.opener?.postMessage(
          {
            type: "google-auth-success",
            access_token: tokenData.access_token,
            expires_in: tokenData.expires_in,
          },
          window.location.origin
        );
      } catch {
        // ignore
      }

      setStatus("success");

      // Prefer closing the popup
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // ignore
        }
      }, 50);

      // If not closed, send user back to settings (will process pending token)
      setTimeout(() => {
        navigate("/settings?oauth=success", { replace: true });
      }, 600);

      return;
    }

    // Error
    if (result.error) {
      const msg = result.error_description || result.error;

      try {
        window.opener?.postMessage(
          {
            type: "google-auth-error",
            error: msg,
          },
          window.location.origin
        );
      } catch {
        // ignore
      }

      setStatus("error");
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // ignore
        }
      }, 800);

      return;
    }

    setStatus("unexpected");
  }, [navigate, result.access_token, result.error, result.error_description, result.expires_in, result.state]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-2">
        {status === "connecting" && (
          <>
            <h1 className="text-lg font-semibold">Conectando…</h1>
            <p className="text-sm text-muted-foreground">
              Processando autenticação do Google Drive.
            </p>
          </>
        )}
        {status === "success" && (
          <>
            <h1 className="text-lg font-semibold">Conectado!</h1>
            <p className="text-sm text-muted-foreground">
              Finalizando… esta janela deve fechar automaticamente.
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="text-lg font-semibold">Erro na autenticação</h1>
            <p className="text-sm text-muted-foreground">
              Você pode fechar esta janela e tentar novamente.
            </p>
          </>
        )}
        {status === "unexpected" && (
          <>
            <h1 className="text-lg font-semibold">Estado inesperado</h1>
            <p className="text-sm text-muted-foreground">
              Feche esta janela e tente novamente.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
