import {
  ArrowRight,
  Camera,
  CheckCircle2,
  FileText,
  FileUp,
  Keyboard,
  Loader2,
  QrCode,
  ScanLine,
  X,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  resolveUniversalScan,
  type UniversalScanResolution,
} from "@/lib/universal-scan-authority";
import { scanKindLabel } from "@/lib/universal-scan";

type Mode = "code" | "camera" | "document";
type ScanSource = "keyboard" | "manual" | "camera";
type DocumentSource = "document_scan" | "camera_capture" | "file_upload";

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorInstance = { detect: (source: unknown) => Promise<BarcodeDetectorResult[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

type UploadReceipt = {
  attachmentId: string;
  sha256Hex: string;
  fileName: string;
};

const WEDGE_GAP_MS = 80;
const MIN_WEDGE_LENGTH = 4;
const MODE_TABS = [
  { value: "code" as const, Icon: QrCode, label: "Code" },
  { value: "camera" as const, Icon: Camera, label: "Camera" },
  { value: "document" as const, Icon: FileText, label: "Document" },
];

function editableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.isContentEditable ||
      element?.tagName === "INPUT" ||
      element?.tagName === "TEXTAREA" ||
      element?.tagName === "SELECT",
  );
}

function detectorConstructor() {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UniversalScanCentre() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("code");
  const [code, setCode] = useState("");
  const [source, setSource] = useState<ScanSource>("manual");
  const [resolution, setResolution] = useState<UniversalScanResolution | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentSource, setDocumentSource] = useState<DocumentSource>("file_upload");
  const [documentType, setDocumentType] = useState("certificate");
  const [uploading, setUploading] = useState(false);
  const [uploadReceipt, setUploadReceipt] = useState<UploadReceipt | null>(null);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);
  const documentFileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraTimerRef = useRef<number | null>(null);
  const wedgeRef = useRef({ buffer: "", lastAt: 0 });

  const stopCamera = useCallback(() => {
    if (cameraTimerRef.current !== null) {
      window.clearTimeout(cameraTimerRef.current);
      cameraTimerRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  const resolveCode = useCallback(async (raw: string, scanSource: ScanSource) => {
    const cleaned = raw.trim();
    if (!cleaned) return;
    setOpen(true);
    setCode(cleaned);
    setSource(scanSource);
    setResolution(null);
    setUploadReceipt(null);
    setResolving(true);
    setError("");
    try {
      const result = await resolveUniversalScan({ data: { code: cleaned } });
      setResolution(result);
      window.dispatchEvent(new CustomEvent("vyndi:scan-resolved", { detail: result }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The scanned record could not be resolved.");
    } finally {
      setResolving(false);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || editableTarget(event.target)) return;
      const now = performance.now();
      if (now - wedgeRef.current.lastAt > WEDGE_GAP_MS) wedgeRef.current.buffer = "";

      if (event.key === "Enter") {
        const buffered = wedgeRef.current.buffer.trim();
        wedgeRef.current = { buffer: "", lastAt: 0 };
        if (buffered.length >= MIN_WEDGE_LENGTH) {
          event.preventDefault();
          void resolveCode(buffered, "keyboard");
        }
        return;
      }

      if (event.key.length === 1) {
        wedgeRef.current.buffer += event.key;
        wedgeRef.current.lastAt = now;
        if (wedgeRef.current.buffer.length > 500) wedgeRef.current.buffer = "";
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [resolveCode]);

  useEffect(() => {
    if (open && mode === "code") {
      const timer = window.setTimeout(() => scanInputRef.current?.focus(), 60);
      return () => window.clearTimeout(timer);
    }
  }, [mode, open]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  async function startCamera() {
    setCameraMessage("");
    setError("");
    stopCamera();

    const Detector = detectorConstructor();
    if (!Detector) {
      setCameraMessage("Native camera QR detection is not available in this browser. Use a USB/Bluetooth scanner or the document camera capture below.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("Camera access is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);

      const detector = new Detector({ formats: ["qr_code", "code_128", "ean_13", "ean_8", "data_matrix"] });
      const detect = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const values = await detector.detect(videoRef.current);
          const rawValue = values.find((value) => value.rawValue?.trim())?.rawValue?.trim();
          if (rawValue) {
            stopCamera();
            await resolveCode(rawValue, "camera");
            setMode("code");
            return;
          }
        } catch {
          // A camera frame can be temporarily unreadable while autofocus settles.
        }
        cameraTimerRef.current = window.setTimeout(() => void detect(), 250);
      };
      void detect();
    } catch (cause) {
      stopCamera();
      setCameraMessage(cause instanceof Error ? cause.message : "Camera permission was not granted.");
    }
  }

  function close() {
    stopCamera();
    setOpen(false);
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    void resolveCode(code, "manual");
  }

  async function openWorkspace() {
    if (!resolution?.route) return;
    close();
    await navigate({ to: resolution.route as never });
  }

  function traceRecord() {
    const query = resolution?.traceabilityQuery ?? code.trim();
    if (!query) return;
    close();
    window.dispatchEvent(new CustomEvent("vyndi:traceability-search", { detail: { query } }));
  }

  function chooseDocument(file: File | null, fileSource: DocumentSource) {
    setDocumentFile(file);
    setDocumentSource(fileSource);
    setUploadReceipt(null);
    setError("");
    if (file) setMode("document");
  }

  async function uploadDocument() {
    if (!documentFile) {
      setError("Choose a PDF/JPG/PNG document or capture an image first.");
      return;
    }
    if (!resolution?.found || !resolution.evidenceTargetType || !resolution.canonicalId) {
      setError("Resolve the governed target record before attaching evidence.");
      return;
    }

    setUploading(true);
    setError("");
    setUploadReceipt(null);
    try {
      const form = new FormData();
      form.set("targetType", resolution.evidenceTargetType);
      form.set("targetId", resolution.canonicalId);
      form.set("documentType", documentType);
      form.set("sourceKind", documentSource);
      form.set("file", documentFile);
      const response = await fetch("/api/scan/evidence", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          payload.error === "duplicate_evidence"
            ? `This evidence is already attached (${String(payload.attachmentId ?? "existing attachment")}).`
            : String(payload.error ?? `Evidence upload failed (HTTP ${response.status}).`),
        );
      }
      setUploadReceipt({
        attachmentId: String(payload.attachmentId ?? ""),
        sha256Hex: String(payload.sha256Hex ?? ""),
        fileName: String(payload.fileName ?? documentFile.name),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Evidence upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-36 right-5 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/35 bg-bg/95 px-4 py-2.5 text-xs font-semibold text-fg shadow-xl backdrop-blur-xl transition hover:border-accent hover:bg-surface print:hidden"
        aria-label="Open universal scanner"
        title="Universal scanner · QR/barcode, camera and document evidence"
      >
        <ScanLine className="size-4 text-accent" />
        <span className="hidden sm:inline">Scan</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] bg-bg/70 p-2 backdrop-blur-md sm:p-4 print:hidden" role="dialog" aria-modal="true" aria-label="VYNDI Universal Scanner">
          <section className="mx-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
            <header className="shrink-0 border-b border-border bg-surface/45 px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-green">MES-SCAN-01 · governed input</p>
                  <h2 className="mt-1 font-display text-xl font-semibold text-fg sm:text-2xl">Universal Scanner</h2>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    USB/Bluetooth scanners, camera QR/barcode capture, and controlled PDF/JPG/PNG evidence intake.
                  </p>
                </div>
                <button type="button" onClick={close} className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:border-accent/50 hover:text-fg" aria-label="Close scanner">
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg p-1" role="tablist" aria-label="Scanner mode">
                {MODE_TABS.map(({ value, Icon, label }) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={mode === value}
                    onClick={() => {
                      if (value !== "camera") stopCamera();
                      setMode(value);
                      setError("");
                    }}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${mode === value ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface hover:text-fg"}`}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {mode === "code" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-surface/30 p-4">
                    <div className="flex items-start gap-3">
                      <Keyboard className="mt-0.5 size-5 shrink-0 text-accent" />
                      <div>
                        <p className="text-sm font-semibold text-fg">Keyboard-wedge scanner</p>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          Always listening while no text field has focus. USB/Bluetooth scanners that type the code and send Enter require no device-specific driver integration.
                        </p>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={submitCode} className="space-y-2">
                    <label className="text-xs font-semibold text-fg" htmlFor="vyndi-universal-scan-code">Scan or enter code</label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        id="vyndi-universal-scan-code"
                        ref={scanInputRef}
                        value={code}
                        onChange={(event) => {
                          setCode(event.target.value);
                          setResolution(null);
                          setUploadReceipt(null);
                        }}
                        className="control min-h-11 flex-1 font-mono text-sm"
                        placeholder="VYNDI:TRV:TRV-… or scan any governed identifier"
                        autoComplete="off"
                      />
                      <button type="submit" disabled={!code.trim() || resolving} className="min-h-11 rounded-md border border-accent/40 bg-accent/10 px-4 text-xs font-semibold text-accent hover:bg-accent/15 disabled:opacity-40">
                        {resolving ? "Resolving…" : "Resolve"}
                      </button>
                    </div>
                    <p className="text-[10px] text-subtle">
                      Preferred QR format: VYNDI:JOB:&lt;id&gt; · VYNDI:TRV:&lt;id/serial&gt; · VYNDI:SKU:&lt;sku&gt; · VYNDI:NCR:&lt;id&gt; · VYNDI:ASSET:&lt;id/serial&gt;.
                    </p>
                  </form>
                </div>
              ) : null}

              {mode === "camera" ? (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-border bg-surface/30">
                    <video ref={videoRef} className="aspect-video w-full bg-bg object-cover" muted playsInline />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void startCamera()} disabled={cameraActive} className="min-h-11 rounded-md border border-accent/40 bg-accent/10 px-4 text-xs font-semibold text-accent hover:bg-accent/15 disabled:opacity-40">
                      {cameraActive ? "Scanning…" : "Start QR / barcode camera"}
                    </button>
                    {cameraActive ? (
                      <button type="button" onClick={stopCamera} className="min-h-11 rounded-md border border-border px-4 text-xs font-semibold text-muted hover:bg-surface hover:text-fg">Stop camera</button>
                    ) : null}
                  </div>
                  <p className="text-xs leading-5 text-muted">
                    Camera decoding uses the browser's native BarcodeDetector when available. Dedicated USB/Bluetooth scanners remain the most reliable shop-floor input.
                  </p>
                  {cameraMessage ? <p className="rounded-lg border border-warn/35 bg-warn/5 p-3 text-xs text-warn">{cameraMessage}</p> : null}
                </div>
              ) : null}

              {mode === "document" ? (
                <div className="space-y-4">
                  <section className="rounded-xl border border-border bg-surface/30 p-4">
                    <p className="text-sm font-semibold text-fg">1 · Resolve the evidence target</p>
                    <p className="mt-1 text-xs leading-5 text-muted">Scan the Job Card, traveller, PO, GRN, SKU, NCR/CAPA, asset or maintenance work order first. The file is evidence attached to that canonical record; it never changes the record itself.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input value={code} onChange={(event) => { setCode(event.target.value); setResolution(null); }} className="control min-h-11 flex-1 font-mono text-sm" placeholder="Scan/enter target code" />
                      <button type="button" onClick={() => void resolveCode(code, "manual")} disabled={!code.trim() || resolving} className="min-h-11 rounded-md border border-accent/40 px-4 text-xs font-semibold text-accent disabled:opacity-40">
                        {resolving ? "Resolving…" : "Resolve target"}
                      </button>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-surface/30 p-4">
                    <p className="text-sm font-semibold text-fg">2 · Capture the document</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => cameraFileRef.current?.click()} className="min-h-11 rounded-md border border-border px-4 text-xs font-semibold text-fg hover:bg-bg">
                        <Camera className="mr-2 inline size-4" /> Camera capture
                      </button>
                      <button type="button" onClick={() => documentFileRef.current?.click()} className="min-h-11 rounded-md border border-border px-4 text-xs font-semibold text-fg hover:bg-bg">
                        <FileUp className="mr-2 inline size-4" /> PDF / image / scanner file
                      </button>
                    </div>
                    <input
                      ref={cameraFileRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(event) => chooseDocument(event.currentTarget.files?.[0] ?? null, "camera_capture")}
                    />
                    <input
                      ref={documentFileRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="hidden"
                      onChange={(event) => chooseDocument(event.currentTarget.files?.[0] ?? null, "document_scan")}
                    />
                    <p className="mt-2 text-[10px] leading-4 text-subtle">
                      Flatbed/TWAIN/WIA scanners can save PDF/JPG/PNG through the operating-system scanner software; select the resulting file here. Maximum 5 MB.
                    </p>

                    {documentFile ? (
                      <div className="mt-3 rounded-lg border border-border bg-bg p-3">
                        <p className="truncate text-xs font-semibold text-fg">{documentFile.name}</p>
                        <p className="mt-1 text-[10px] text-muted">{documentFile.type || "Detected on upload"} · {fileSize(documentFile.size)}</p>
                      </div>
                    ) : null}

                    <label className="mt-3 block text-xs font-semibold text-fg">
                      Evidence type
                      <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="control mt-1 w-full">
                        <option value="certificate">Certificate / CoC / material certificate</option>
                        <option value="inspection_report">Inspection / test report</option>
                        <option value="invoice">Invoice</option>
                        <option value="receipt">Receipt / payment evidence</option>
                        <option value="delivery_document">Delivery challan / dispatch document</option>
                        <option value="photo">Photo evidence</option>
                        <option value="other">Other controlled evidence</option>
                      </select>
                    </label>
                  </section>

                  <button
                    type="button"
                    onClick={() => void uploadDocument()}
                    disabled={uploading || !documentFile || !resolution?.found || !resolution.evidenceTargetType}
                    className="min-h-11 w-full rounded-md border border-accent/40 bg-accent/10 px-4 text-sm font-semibold text-accent hover:bg-accent/15 disabled:opacity-40"
                  >
                    {uploading ? "Capturing evidence…" : "Attach governed evidence"}
                  </button>

                  {uploadReceipt ? (
                    <div className="rounded-xl border border-green/35 bg-green/5 p-4">
                      <p className="flex items-center gap-2 text-sm font-semibold text-green"><CheckCircle2 className="size-4" /> Evidence receipt created</p>
                      <p className="mt-2 break-all text-xs text-muted">{uploadReceipt.attachmentId}</p>
                      <p className="mt-1 truncate text-[10px] text-subtle">{uploadReceipt.fileName} · SHA-256 {uploadReceipt.sha256Hex.slice(0, 16)}…</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {resolving ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface/30 p-3 text-xs text-muted">
                  <Loader2 className="size-4 animate-spin" /> Resolving against governed records…
                </div>
              ) : null}

              {resolution ? (
                <section className={`mt-4 rounded-xl border p-4 ${resolution.found ? "border-green/35 bg-green/5" : "border-warn/35 bg-warn/5"}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Resolved input · {source}</p>
                  <p className="mt-1 text-sm font-semibold text-fg">{resolution.found ? resolution.label : scanKindLabel(resolution.kind)}</p>
                  <p className="mt-1 text-xs text-muted">
                    {resolution.found ? `${resolution.status || "recorded"} · ${resolution.canonicalId}` : resolution.recognized ? `No canonical record found for ${resolution.identifier}.` : "Unclassified scan. You can search the governed traceability thread using the raw value."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {resolution.route && resolution.found ? (
                      <button type="button" onClick={() => void openWorkspace()} className="min-h-10 rounded-md border border-border px-3 text-xs font-semibold text-fg hover:bg-bg">
                        Open workspace <ArrowRight className="ml-1 inline size-3.5" />
                      </button>
                    ) : null}
                    {resolution.traceabilityQuery || !resolution.recognized ? (
                      <button type="button" onClick={traceRecord} className="min-h-10 rounded-md border border-accent/40 px-3 text-xs font-semibold text-accent hover:bg-accent/10">
                        Trace governed record
                      </button>
                    ) : null}
                    {resolution.found && mode !== "document" ? (
                      <button type="button" onClick={() => setMode("document")} className="min-h-10 rounded-md border border-border px-3 text-xs font-semibold text-muted hover:bg-bg hover:text-fg">
                        Attach document
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {error ? <p className="mt-4 rounded-lg border border-danger/35 bg-danger/5 p-3 text-xs text-danger" role="alert">{error}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
