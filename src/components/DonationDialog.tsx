import { useState } from "react";
import { Copy, Check, Heart, Mail, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PIX_KEY = "0fd1dcd7-4db0-4888-bd44-6384b7d3d888";
const BTC_ADDRESS = "bc1qtf0y90vgxvq39wvypddzm034jz7c62xj7pf64x";
const SUPPORT_EMAIL = "gestaodegastosapp@gmail.com";

// Gera payload EMV estático para PIX (padrão Banco Central do Brasil)
function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function buildPixPayload(key: string): string {
  const name = "Claudio Rico";
  const city = "SAO PAULO";
  const inner = `0014br.gov.bcb.pix0136${key}`;
  const ma = `26${String(inner.length).padStart(2, "0")}${inner}`;
  const nm = `59${String(name.length).padStart(2, "0")}${name}`;
  const ct = `60${String(city.length).padStart(2, "0")}${city}`;
  const base = `000201${ma}5204000053039865802BR${nm}${ct}62070503***6304`;
  return base + crc16(base);
}

const PIX_PAYLOAD = buildPixPayload(PIX_KEY);
const BTC_URI = `bitcoin:${BTC_ADDRESS}`;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
        <code className="flex-1 text-sm font-mono break-all select-all">{value}</code>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopy}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

function QRBlock({ value }: { value: string }) {
  return (
    <div className="flex justify-center rounded-xl bg-white p-4">
      <QRCode value={value} size={176} />
    </div>
  );
}

export function DonationDialog({ trigger }: { trigger?: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            className="gap-2 border-pink-500/30 hover:border-pink-500/60 hover:bg-pink-500/5 text-pink-500 hover:text-pink-500"
          >
            <Heart className="h-4 w-4" />
            Apoie o desenvolvedor
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-pink-500" />
            Apoie o desenvolvedor
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          App gratuito e sem anúncios. Se este app te ajuda, qualquer valor é muito bem-vindo!
        </p>
        <Tabs defaultValue="pix">
          <TabsList className="w-full">
            <TabsTrigger value="pix" className="flex-1">
              💸 PIX
            </TabsTrigger>
            <TabsTrigger value="btc" className="flex-1">
              ₿ Bitcoin
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pix" className="space-y-3 pt-2">
            <QRBlock value={PIX_PAYLOAD} />
            <CopyField label="Chave PIX (aleatória)" value={PIX_KEY} />
            <p className="text-xs text-muted-foreground">Nubank · Claudio Luciano Rico</p>
          </TabsContent>

          <TabsContent value="btc" className="space-y-3 pt-2">
            <QRBlock value={BTC_URI} />
            <CopyField label="Endereço Bitcoin" value={BTC_ADDRESS} />
            <p className="text-xs text-muted-foreground">Rede Bitcoin · Native SegWit (bc1)</p>
          </TabsContent>
        </Tabs>

        <div className="pt-3 border-t border-border/50 space-y-2">
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Cofre Investimentos - Suporte`}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Mail className="h-4 w-4 shrink-0" />
            {SUPPORT_EMAIL}
          </a>
          <Link
            to="/privacy"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Shield className="h-4 w-4 shrink-0" />
            Política de privacidade
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
