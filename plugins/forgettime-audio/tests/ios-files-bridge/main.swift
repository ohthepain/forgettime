import Foundation
let root = URL(fileURLWithPath: CommandLine.arguments[1])
var store = try NativeBarFiles(root: root)
while let line = readLine() {
    do {
        let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
        let method = request["method"] as! String, args = request["args"] as? [String: Any] ?? [:]
        var output: [String: Any] = [:]
        switch method {
        case "analyzeFixture":
            let rate = args["sampleRate"] as! Double, detector = DrumOnsetDetector(sampleRate: rate)
            let data = try Data(contentsOf: URL(fileURLWithPath: args["path"] as! String))
            let samples = data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
            var onsets: [[String: Double]] = []
            for (index, sample) in samples.enumerated() { if let hit = detector.process(sample: Double(sample), time: Double(index) / rate) { onsets.append(["time": hit.time, "strength": hit.strength, "confidence": hit.confidence]) } }
            output = ["onsets": onsets, "diagnostics": detector.drainDiagnostics()]
        case "restart": store = try NativeBarFiles(root: root)
        case "listSavedBars": output = ["bars": try store.list()]
        case "beginBarSave": output = ["transferId": try store.beginBarSave(summary: args["summary"] as! [String: Any], wavBytes: args["wavBytes"] as! Int, sidecarBytes: args["sidecarBytes"] as! Int)]
        case "appendFileChunk": try store.append(transferId: args["transferId"] as! String, part: args["part"] as! String, offset: args["offset"] as! Int, data: Data(base64Encoded: args["data"] as! String)!)
        case "commitBarSave": try store.commit(transferId: args["transferId"] as! String)
        case "abortFileTransfer": store.abort(transferId: args["transferId"] as! String)
        case "readSavedBar": output = try store.read(id: args["id"] as! String)
        case "readFileChunk": output = ["data": try store.readChunk(handle: args["handle"] as! String, offset: args["offset"] as! Int, length: args["length"] as! Int).base64EncodedString()]
        case "releaseFiles": store.release(handles: args["handles"] as! [String])
        case "beginAudioDecode": output = ["transferId": try store.beginDecode(name: args["name"] as! String, byteLength: args["byteLength"] as! Int)]
        case "finishAudioDecode": output = try store.finishDecode(transferId: args["transferId"] as! String)
        // Only OS presentation is substituted. Selection copying/export bytes still use production storage.
        case "pickAudioFiles": output = ["files": try (args["paths"] as? [String] ?? []).map { try store.copySelected(url: URL(fileURLWithPath: $0)) }]
        case "exportSavedBar": let pair = try store.exportPair(id: args["id"] as! String); store.release(handles: pair.handles); output = ["status": "cancelled"]
        default: throw FileFailure.invalid("Unknown fixture operation")
        }
        print(String(data: try JSONSerialization.data(withJSONObject: ["result": output], options: [.sortedKeys]), encoding: .utf8)!)
    } catch { print(String(data: try! JSONSerialization.data(withJSONObject: ["error": error.localizedDescription]), encoding: .utf8)!) }
    fflush(stdout)
}
