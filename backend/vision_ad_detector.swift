import Foundation
import CoreGraphics
import ImageIO
import AVFoundation
import Vision
import Darwin

// Lower process scheduling priority so video playback, fullscreen animations, and audio DSP always take precedence
setpriority(PRIO_PROCESS, 0, 10)

struct TextBoxInfo: Codable {
    let text: String
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct FrameAnalysis: Codable {
    let ok: Bool
    let timestamp: Double?
    let actual_time: Double?
    let is_ad: Bool
    let is_central: Bool
    let score: Int
    let brand: String
    let matched: [String]
    let has_qr: Bool
    let top_bar: Double
    let bottom_bar: Double
    let luma_mean: Double
    let boxes_count: Int
}

final class AssetGeneratorEntry {
    let url: String
    let asset: AVURLAsset
    let fastGen: AVAssetImageGenerator
    let exactGen: AVAssetImageGenerator
    var lastUsed: TimeInterval

    init(url: String) {
        self.url = url
        let u = URL(string: url)!
        self.asset = AVURLAsset(url: u, options: [AVURLAssetPreferPreciseDurationAndTimingKey: false])

        self.fastGen = AVAssetImageGenerator(asset: self.asset)
        self.fastGen.appliesPreferredTrackTransform = true
        self.fastGen.maximumSize = CGSize(width: 512, height: 288)
        self.fastGen.requestedTimeToleranceBefore = CMTime(seconds: 3.2, preferredTimescale: 600)
        self.fastGen.requestedTimeToleranceAfter = CMTime(seconds: 3.2, preferredTimescale: 600)

        self.exactGen = AVAssetImageGenerator(asset: self.asset)
        self.exactGen.appliesPreferredTrackTransform = true
        self.exactGen.maximumSize = CGSize(width: 512, height: 288)
        self.exactGen.requestedTimeToleranceBefore = CMTime(seconds: 0.45, preferredTimescale: 600)
        self.exactGen.requestedTimeToleranceAfter = CMTime(seconds: 0.45, preferredTimescale: 600)

        self.lastUsed = Date().timeIntervalSince1970
    }
}

var generatorCache: [String: AssetGeneratorEntry] = [:]

func getGeneratorEntry(_ url: String) -> AssetGeneratorEntry? {
    guard url.hasPrefix("http://") || url.hasPrefix("https://") else { return nil }
    if let existing = generatorCache[url] {
        existing.lastUsed = Date().timeIntervalSince1970
        return existing
    }
    if generatorCache.count >= 3 {
        if let oldestKey = generatorCache.min(by: { $0.value.lastUsed < $1.value.lastUsed })?.key {
            generatorCache[oldestKey]?.fastGen.cancelAllCGImageGeneration()
            generatorCache[oldestKey]?.exactGen.cancelAllCGImageGeneration()
            generatorCache.removeValue(forKey: oldestKey)
        }
    }
    let entry = AssetGeneratorEntry(url: url)
    generatorCache[url] = entry
    return entry
}

// Homoglyph map: converts Cyrillic lookalikes to Latin lowercase so mixed-script OCR like "1ХВЕT" -> "1xbet"
let cyrToLatMap: [Character: Character] = [
    "а": "a", "в": "b", "с": "c", "е": "e", "н": "h",
    "к": "k", "м": "m", "о": "o", "р": "p", "т": "t",
    "у": "y", "х": "x", "і": "i"
]

func toLatinSkeleton(_ s: String) -> String {
    let low = s.lowercased()
    var out = String()
    out.reserveCapacity(low.count)
    for ch in low {
        if let mapped = cyrToLatMap[ch] {
            out.append(mapped)
        } else {
            out.append(ch)
        }
    }
    return out
}

func collapseSeparators(_ s: String) -> String {
    var out = String()
    out.reserveCapacity(s.count)
    for ch in s {
        if ch.isLetter || ch.isNumber {
            out.append(ch)
        }
    }
    return out
}

struct Tier1Brand {
    let label: String
    let compactTokens: [String]   // matched against collapsed alphanumeric string (e.g. "1xbet", "dragonmoney")
    let wordTokens: [String]      // matched with word boundary (e.g. "1win")
}

let tier1Brands: [Tier1Brand] = [
    Tier1Brand(label: "1xBet", compactTokens: ["1xbet", "1xбет", "1хбет", "1xstavka", "1хставка"], wordTokens: []),
    Tier1Brand(label: "1win", compactTokens: [], wordTokens: ["1win", "1вин", "1w1n"]),
    Tier1Brand(label: "Melbet", compactTokens: ["melbet", "мелбет", "meлбет"], wordTokens: []),
    Tier1Brand(label: "Mostbet", compactTokens: ["mostbet", "мостбет"], wordTokens: []),
    Tier1Brand(label: "Fonbet", compactTokens: ["fonbet", "фонбет"], wordTokens: []),
    Tier1Brand(label: "BetBoom", compactTokens: ["betboom", "бетбум"], wordTokens: []),
    Tier1Brand(label: "Winline", compactTokens: ["winline", "винлайн"], wordTokens: []),
    Tier1Brand(label: "Olimpbet", compactTokens: ["olimpbet", "олимпбет"], wordTokens: []),
    Tier1Brand(label: "Parimatch", compactTokens: ["parimatch", "париматч", "pariru"], wordTokens: []),
    Tier1Brand(label: "Лига Ставок", compactTokens: ["ligastavok", "лигаставок"], wordTokens: []),
    Tier1Brand(label: "Vavada", compactTokens: ["vavada", "вавада"], wordTokens: []),
    Tier1Brand(label: "Dragon Money", compactTokens: ["dragonmoney", "драгонмани"], wordTokens: []),
    Tier1Brand(label: "Azino777", compactTokens: ["azino777", "азино777"], wordTokens: []),
    Tier1Brand(label: "JoyCasino", compactTokens: ["joycasino", "джойказино"], wordTokens: []),
    Tier1Brand(label: "CatCasino", compactTokens: ["catcasino", "кэтказино"], wordTokens: []),
    Tier1Brand(label: "Kometa Casino", compactTokens: ["kometacasino", "кометаказино", "r7casino", "kentcasino", "gamacasino", "daddycasino", "arkadacasino"], wordTokens: []),
    Tier1Brand(label: "Betting", compactTokens: ["vodkabet", "888starz", "spinbetter", "betwinner", "linebet", "betcity", "бетсити", "marathonbet", "марафонбет", "baltbet", "балтбет", "zenitbet"], wordTokens: [])
]

func containsWordBoundary(_ haystack: String, _ needle: String) -> Bool {
    guard let range = haystack.range(of: needle) else { return false }
    let beforeOk: Bool
    if range.lowerBound == haystack.startIndex {
        beforeOk = true
    } else {
        let prev = haystack[haystack.index(before: range.lowerBound)]
        beforeOk = !(prev.isLetter || prev.isNumber)
    }
    let afterOk: Bool
    if range.upperBound == haystack.endIndex {
        afterOk = true
    } else {
        let next = haystack[range.upperBound]
        afterOk = !(next.isLetter || next.isNumber)
    }
    return beforeOk && afterOk
}

func measureFrameBarsAndLuma(_ cgImage: CGImage) -> (Double, Double, Double) {
    let w = 32
    let h = 36
    var pixels = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(
        data: &pixels,
        width: w,
        height: h,
        bitsPerComponent: 8,
        bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return (0, 0, 0)
    }
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))

    var rowLuma = [Double](repeating: 0, count: h)
    var totalLuma = 0.0
    for y in 0..<h {
        var rowSum = 0.0
        for x in 2..<(w - 2) {
            let idx = (y * w + x) * 4
            let r = Double(pixels[idx])
            let g = Double(pixels[idx + 1])
            let b = Double(pixels[idx + 2])
            let l = 0.299 * r + 0.587 * g + 0.114 * b
            rowSum += l
        }
        let avg = rowSum / Double(w - 4)
        rowLuma[y] = avg
        totalLuma += avg
    }
    let meanLuma = totalLuma / Double(h)

    var topRows = 0
    for y in 0..<(h / 3) {
        if rowLuma[y] < 11.5 {
            topRows += 1
        } else {
            break
        }
    }
    var bottomRows = 0
    for y in stride(from: h - 1, through: (h * 2) / 3, by: -1) {
        if rowLuma[y] < 11.5 {
            bottomRows += 1
        } else {
            break
        }
    }
    return (Double(topRows) / Double(h), Double(bottomRows) / Double(h), meanLuma)
}

func scoreObservations(_ boxes: [TextBoxInfo], hasQr: Bool, qrBoxes: [CGRect]) -> (Int, String, [String], Bool) {
    if boxes.isEmpty && !hasQr {
        return (0, "", [], false)
    }

    var totalScore = 0
    var detectedBrand = ""
    var matchedTerms: [String] = []
    var adBoxes: [CGRect] = []

    if hasQr {
        totalScore += 50
        matchedTerms.append("QR")
        adBoxes.append(contentsOf: qrBoxes)
    }

    // Score both individual lines and full combined frame text (since brand + promo often span 2 adjacent lines)
    let rawJoined = boxes.map { $0.text }.joined(separator: " ")
    let lowJoined = rawJoined.lowercased()
    let skelJoined = toLatinSkeleton(rawJoined)
    let compactRaw = collapseSeparators(lowJoined)
    let compactSkel = collapseSeparators(skelJoined)

    for b in tier1Brands {
        var hit = false
        for tok in b.compactTokens {
            let tokSkel = toLatinSkeleton(tok)
            if compactRaw.contains(tok) || compactSkel.contains(tokSkel) {
                hit = true
                break
            }
        }
        if !hit {
            for wtok in b.wordTokens {
                let wSkel = toLatinSkeleton(wtok)
                if containsWordBoundary(lowJoined, wtok) || containsWordBoundary(skelJoined, wSkel) {
                    hit = true
                    break
                }
            }
        }
        if hit {
            totalScore += 100
            if detectedBrand.isEmpty { detectedBrand = b.label }
            matchedTerms.append(b.label)
        }
    }

    // Compound promo / betting tokens (require combination >= 100 so single everyday words never false-trigger)
    let promoRules: [(String, [String], Int)] = [
        ("Промокод", ["промокод", "по промокоду", "promocode", "promo code"], 65),
        ("Фрибет", ["фрибет", "freebet", "фриспин", "freespin"], 75),
        ("Ставки на спорт", ["ставки на спорт", "ставь на спорт", "высокие коэффициенты", "быстрые выплаты"], 75),
        ("Бонус на депозит", ["бонус до", "бонус на депозит", "первый депозит", "кэшбэк до", "забирай бонус", "забрать бонус"], 65),
        ("Pin-Up", ["pin-up", "pinup", "пин-ап", "пинап"], 65),
        ("Букмекер", ["букмекер", "бк леон", "бк пари", "leon.ru", "pari.ru", "up-x", "вулкан"], 60),
        ("Казино/Депозит", ["онлайн казино", "крути слоты", "депозит", "выигрывай"], 45)
    ]

    for (label, variants, pts) in promoRules {
        for v in variants {
            if lowJoined.contains(v) || skelJoined.contains(toLatinSkeleton(v)) {
                totalScore += pts
                if detectedBrand.isEmpty && pts >= 65 {
                    detectedBrand = label
                }
                matchedTerms.append(label)
                break
            }
        }
    }

    // Identify which text boxes contributed or look like ad headlines to determine central vs small corner banner
    for box in boxes {
        let bl = box.text.lowercased()
        let bs = toLatinSkeleton(box.text)
        let bc = collapseSeparators(bs)
        var boxIsAdRelated = false
        for b in tier1Brands {
            if b.compactTokens.contains(where: { bc.contains(toLatinSkeleton($0)) || collapseSeparators(bl).contains($0) }) ||
               b.wordTokens.contains(where: { containsWordBoundary(bl, $0) || containsWordBoundary(bs, toLatinSkeleton($0)) }) {
                boxIsAdRelated = true
                break
            }
        }
        if !boxIsAdRelated {
            let adWords = ["промокод", "фрибет", "freebet", "бонус", "ставк", "депозит", "выплат", "коэффициент", "казино", "pin-up", "pinup", "pari", "leon"]
            if adWords.contains(where: { bl.contains($0) || bs.contains(toLatinSkeleton($0)) }) {
                boxIsAdRelated = true
            }
        }
        if boxIsAdRelated {
            adBoxes.append(CGRect(x: box.x, y: box.y, width: box.w, height: box.h))
        }
    }

    var isCentral = false
    if totalScore >= 100 {
        var minY = 1.0
        var maxY = 0.0
        for r in adBoxes {
            let midY = r.midY
            minY = min(minY, r.minY)
            maxY = max(maxY, r.maxY)
            // Central vertical zone [0.21, 0.79] with meaningful width/height, or large splash typography
            if (midY >= 0.21 && midY <= 0.79 && (r.width >= 0.18 || r.height >= 0.055)) ||
               r.height >= 0.085 ||
               r.width >= 0.48 {
                isCentral = true
            }
        }
        if adBoxes.count >= 2 && (maxY - minY) >= 0.26 {
            isCentral = true
        }
    }

    return (totalScore, detectedBrand.isEmpty ? "Реклама ставок" : detectedBrand, matchedTerms, isCentral)
}

let sharedFastTextReq: VNRecognizeTextRequest = {
    let r = VNRecognizeTextRequest()
    r.recognitionLevel = .fast
    r.usesLanguageCorrection = false
    r.minimumTextHeight = 0.028
    return r
}()

let sharedAccTextReq: VNRecognizeTextRequest = {
    let r = VNRecognizeTextRequest()
    r.recognitionLevel = .accurate
    r.recognitionLanguages = ["ru-RU", "en-US"]
    r.usesLanguageCorrection = false
    r.minimumTextHeight = 0.028
    return r
}()

let sharedQrReq: VNDetectBarcodesRequest = {
    let r = VNDetectBarcodesRequest()
    r.symbologies = [.qr]
    return r
}()

func extractBoxes(_ req: VNRecognizeTextRequest) -> [TextBoxInfo] {
    guard let obsList = req.results else { return [] }
    var out: [TextBoxInfo] = []
    out.reserveCapacity(obsList.count)
    for obs in obsList {
        if let top = obs.topCandidates(1).first {
            let s = top.string.trimmingCharacters(in: .whitespacesAndNewlines)
            if !s.isEmpty {
                let b = obs.boundingBox
                out.append(TextBoxInfo(text: s, x: Double(b.minX), y: Double(b.minY), w: Double(b.width), h: Double(b.height)))
            }
        }
    }
    return out
}

func analyzeCGImage(_ cgImage: CGImage, reqTime: Double? = nil, actTime: Double? = nil) -> FrameAnalysis {
    let (topBar, bottomBar, lumaMean) = measureFrameBarsAndLuma(cgImage)
    // Skip pure black frames immediately (0ms OCR cost)
    if lumaMean < 4.0 {
        return FrameAnalysis(
            ok: true, timestamp: reqTime, actual_time: actTime,
            is_ad: false, is_central: false, score: 0, brand: "", matched: [],
            has_qr: false, top_bar: topBar, bottom_bar: bottomBar, luma_mean: lumaMean, boxes_count: 0
        )
    }

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try? handler.perform([sharedFastTextReq, sharedQrReq])

    let fastBoxes = extractBoxes(sharedFastTextReq)
    let qrObs = sharedQrReq.results ?? []
    let hasQr = !qrObs.isEmpty
    let qrRects = qrObs.map { $0.boundingBox }

    var (score, brand, matched, isCentral) = scoreObservations(fastBoxes, hasQr: hasQr, qrBoxes: qrRects)
    var finalBoxesCount = fastBoxes.count

    // Stage 2: Only run Neural Engine Russian .accurate OCR if Stage 1 saw text/QR on screen and wasn't already >= 100 with central certainty
    let hasMeaningfulFastText = fastBoxes.contains { $0.text.count >= 3 }
    if (score < 100 || !isCentral) && (hasMeaningfulFastText || hasQr) {
        let accHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try? accHandler.perform([sharedAccTextReq])
        let accBoxes = extractBoxes(sharedAccTextReq)
        if !accBoxes.isEmpty {
            let accScored = scoreObservations(accBoxes, hasQr: hasQr, qrBoxes: qrRects)
            if accScored.0 >= score {
                score = accScored.0
                brand = accScored.1
                matched = accScored.2
                isCentral = isCentral || accScored.3
                finalBoxesCount = accBoxes.count
            }
        }
    }

    return FrameAnalysis(
        ok: true,
        timestamp: reqTime,
        actual_time: actTime,
        is_ad: score >= 100,
        is_central: isCentral,
        score: score,
        brand: score >= 100 ? brand : "",
        matched: score >= 100 ? matched : [],
        has_qr: hasQr,
        top_bar: (topBar * 1000).rounded() / 1000,
        bottom_bar: (bottomBar * 1000).rounded() / 1000,
        luma_mean: (lumaMean * 10).rounded() / 10,
        boxes_count: finalBoxesCount
    )
}

struct BatchResponse: Codable {
    let ok: Bool
    let frames: [FrameAnalysis]
}

let encoder = JSONEncoder()

func writeJsonLine<T: Encodable>(_ obj: T) {
    if let data = try? encoder.encode(obj), let str = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write((str + "\n").data(using: .utf8)!)
    } else {
        FileHandle.standardOutput.write("{\"ok\":false}\n".data(using: .utf8)!)
    }
}

while let line = readLine(strippingNewline: true) {
    if line.isEmpty { continue }
    autoreleasepool {
        guard let reqData = line.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: reqData)) as? [String: Any],
              let cmd = json["cmd"] as? String else {
            FileHandle.standardOutput.write("{\"ok\":false,\"error\":\"bad_json\"}\n".data(using: .utf8)!)
            return
        }

        if cmd == "ping" {
            FileHandle.standardOutput.write("{\"ok\":true,\"pong\":true}\n".data(using: .utf8)!)
            return
        }

        if cmd == "analyze_jpeg_b64" {
            guard let b64 = json["jpeg_b64"] as? String,
                  let imgData = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
                  let src = CGImageSourceCreateWithData(imgData as CFData, nil),
                  let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
                FileHandle.standardOutput.write("{\"ok\":false,\"error\":\"bad_image\"}\n".data(using: .utf8)!)
                return
            }
            let t = json["timestamp"] as? Double
            let res = analyzeCGImage(cg, reqTime: t, actTime: t)
            writeJsonLine(res)
            return
        }

        if cmd == "scan_stream_window" {
            guard let mp4Url = json["mp4_url"] as? String,
                  let rawTimes = json["timestamps"] as? [Any],
                  let entry = getGeneratorEntry(mp4Url) else {
                FileHandle.standardOutput.write("{\"ok\":false,\"frames\":[]}\n".data(using: .utf8)!)
                return
            }
            let exact = (json["exact"] as? Bool) ?? false
            let stopAfterCleanRun = (json["stop_after_clean_run"] as? Int) ?? 0
            let gen = exact ? entry.exactGen : entry.fastGen

            var outFrames: [FrameAnalysis] = []
            var cleanStreak = 0
            var sawAnyAd = false

            for item in rawTimes {
                let sec: Double
                if let d = item as? Double { sec = d }
                else if let i = item as? Int { sec = Double(i) }
                else if let n = item as? NSNumber { sec = n.doubleValue }
                else { continue }

                let cm = CMTime(seconds: max(0.0, sec), preferredTimescale: 600)
                var actual = CMTime.zero
                let sem = DispatchSemaphore(value: 0)
                var fetchedImage: CGImage? = nil
                gen.generateCGImageAsynchronously(for: cm) { cg, actTime, _ in
                    fetchedImage = cg
                    actual = actTime
                    sem.signal()
                }
                let waitRes = sem.wait(timeout: .now() + 5.5)
                if waitRes == .timedOut {
                    gen.cancelAllCGImageGeneration()
                    break
                }
                if let cg = fetchedImage {
                    let fa = analyzeCGImage(cg, reqTime: sec, actTime: actual.seconds)
                    outFrames.append(fa)
                    if fa.is_ad {
                        sawAnyAd = true
                        cleanStreak = 0
                    } else if sawAnyAd {
                        cleanStreak += 1
                        if stopAfterCleanRun > 0 && cleanStreak >= stopAfterCleanRun {
                            break
                        }
                    }
                }
            }
            writeJsonLine(BatchResponse(ok: true, frames: outFrames))
            return
        }

        FileHandle.standardOutput.write("{\"ok\":false,\"error\":\"unknown_cmd\"}\n".data(using: .utf8)!)
    }
}
