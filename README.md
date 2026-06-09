# SVG-to-Siemens-Dynamic-SVG-Generator

Eine reine Frontend-Webanwendung zum Umwandeln normaler SVG-Dateien in Siemens WinCC Unified Dynamic SVGs (`.svghmi`) für TIA Portal V20 und neuer.

## Zweck

Die Anwendung unterstützt den typischen Engineering-Workflow, bei dem ein bestehendes Standard-SVG als grafisches Element genutzt, einzelne Farben als HMI-Properties dynamisiert und anschließend als Siemens-kompatible Dynamic-SVG-Datei exportiert werden sollen.

Die App läuft vollständig lokal im Browser:

- kein Backend
- kein Upload
- keine Datenbank
- keine externen JavaScript-Abhängigkeiten
- keine Build-Pipeline
- direkt nutzbar über `index.html` oder GitHub Pages

## Funktionen

- SVG-Import per Dateiauswahl oder Drag & Drop
- lokale Verarbeitung mit `FileReader`, `DOMParser`, `XMLSerializer`, `Blob` und `URL.createObjectURL`
- Sicherheits- und Kompatibilitätsprüfung für problematische SVG-Inhalte
- Entfernen bzw. Bereinigen von Skripten, Event-Handlern und externen Referenzen
- Farberkennung aus:
  - `fill`
  - `stroke`
  - `stop-color`
  - `flood-color`
  - `lighting-color`
  - Inline-Styles wie `style="fill:#ff0000; stroke:#000000"`
- Normalisierung von Farben, z. B. `#fff` zu `#FFFFFF`, `rgb(255, 0, 0)` zu `#FF0000` und bekannte Farbnamen zu Hex-Werten
- `currentColor` in Paint-Attributen wird über die nächste SVG/CSS-`color`-Angabe aufgelöst; ohne explizite `color`-Angabe wird Schwarz (`#000000`) als dynamisierbare Default-Farbe verwendet
- Sonderwerte wie `none`, `transparent`, `inherit`, `initial` und `unset` werden nicht automatisch dynamisiert
- pro Farbe auswählbar:
  - statisch lassen
  - dynamisieren
  - Property-Name vergeben
  - Default-Farbe setzen
- Validierung von Property-Namen
- Originalvorschau und dynamische Testvorschau
- Test-Color-Picker für dynamisierte Properties
- Export als `.svghmi`
- Anzeige des erzeugten Codes
- Kopieren in die Zwischenablage
- optionaler Download des bereinigten SVGs

## Nutzung

### Lokal

1. Repository klonen oder herunterladen.
2. `index.html` direkt in einem modernen Browser öffnen.
3. Eine `.svg`-Datei auswählen oder in den Importbereich ziehen.
4. Warnungen prüfen.
5. Farben auswählen, die dynamisch werden sollen.
6. Property-Namen und Default-Farben festlegen.
7. In der Testvorschau mit den Color-Pickern prüfen.
8. `.svghmi` herunterladen.

### Beispiel-Workflow für WinCC Unified

1. SVG importieren.
2. Farben dynamisieren, z. B. `BodyColor`, `StrokeColor` oder `AlarmColor`.
3. `.svghmi` exportieren.
4. Datei im TIA-Projekt unter `UserFiles/SVGControls` verwenden.
5. Dynamic Widget in WinCC Unified einfügen.
6. Die erzeugten `HmiColor`-Parameter im Engineering an Variablen, Zustände oder Animationen anbinden.

## GitHub Pages Deployment

Das Repository enthält einen GitHub-Actions-Workflow unter `.github/workflows/pages.yml`.

Der Workflow:

- läuft bei Push auf `main`
- kann manuell per `workflow_dispatch` gestartet werden
- verwendet offizielle GitHub Pages Actions:
  - `actions/configure-pages`
  - `actions/upload-pages-artifact`
  - `actions/deploy-pages`
- veröffentlicht die statischen Dateien direkt aus dem Repository

Damit die App über GitHub Pages erreichbar ist, muss in den Repository-Einstellungen GitHub Pages mit **GitHub Actions** als Quelle aktiviert sein. Nach einem Push auf `main` stellt GitHub die finale Pages-URL im Deployment bereit.

## Siemens SVGHMI-Export

Der Export erzeugt eine Siemens-HMI-SVG-Grundstruktur mit:

- Siemens DOCTYPE für TIA-HMI SVG
- `xmlns:hmi="http://svg.siemens.com/hmi/"`
- `xmlns:hmi-bind="http://svg.siemens.com/hmi/bind/"`
- `hmi:self` mit `type`, `displayName`, `name`, `version` und `performanceClass`, damit TIA Portal einen gültigen SVG-Namen analysieren kann
- je dynamischer Farbe ein `hmi:paramDef` mit `type="HmiColor"`
- `hmi-bind:*`-Attributen für dynamisierte SVG-Farben; geerbte Farben von `<svg>` oder `<g>` werden beim Export auf die eigentlichen Grafikelemente wie `<path>` übertragen

Beispielprinzip:

```xml
<hmi:self type="widget" displayName="Example" name="extended.Example" version="1.0.0" performanceClass="L">
  <hmi:paramDef name="BodyColor" type="HmiColor" default="0xFF009999" />
</hmi:self>
<rect hmi-bind:fill="{{Converter.RGBA(ParamProps.BodyColor)}}" />
```

## Prüfungen und Sicherheit

Importierte SVG-Dateien können aktive oder externe Inhalte enthalten. Die Anwendung führt deshalb eine lokale Bereinigung durch und zeigt eine Warnliste an.

Geprüft bzw. bereinigt werden unter anderem:

- `<script>`
- `<foreignObject>`
- SVG-Animationen wie `<animate>`, `<animateTransform>`, `<animateMotion>` und `<set>`
- `<style>`-Blöcke
- Inline-Styles
- Event-Handler-Attribute wie `onclick`, `onload` oder `onmouseover`
- externe Referenzen in `href`, `xlink:href`, `src` und externen `url(...)`-Werten
- fehlende `viewBox`
- potenziell problematische Features wie `filter`, `mask`, `pattern`, `image` oder `use`

Die Vorschau verwendet bereinigte SVG-Daten als Blob-URL. Skripte aus dem importierten SVG werden nicht als JavaScript ausgeführt.

## Einschränkungen

- Die App ist ein Generator und ersetzt keine finale Validierung im TIA Portal.
- Icons aus Libraries wie Tabler, die häufig `stroke="currentColor"` am `<svg>` verwenden, werden als dynamisierbare Stroke-Farbe erkannt.
- Nicht jedes SVG-Feature wird von jeder WinCC Unified Runtime identisch unterstützt.
- Komplexe CSS-Kaskaden aus entfernten `<style>`-Blöcken werden nicht vollständig aufgelöst.
- Farbwerte in komplexen Verläufen werden erkannt, sofern sie in unterstützten Farbattributen stehen.
- Externe Bilder, Fonts oder Links werden aus Sicherheits- und Offline-Gründen entfernt.
- Die erzeugte Datei sollte im Zielprojekt mit TIA Portal V20+ getestet werden.

## Projektstruktur

```text
/
├── index.html
├── style.css
├── app.js
├── README.md
├── LICENSE
└── .github/
    └── workflows/
        └── pages.yml
```

## Entwicklung

Es gibt keine Installationsschritte. Änderungen an HTML, CSS oder JavaScript können direkt im Browser getestet werden. Für eine schnelle statische Prüfung kann optional ein lokaler HTTP-Server genutzt werden, zwingend erforderlich ist er nicht.

## Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Siehe `LICENSE`.
