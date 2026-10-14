import Foundation

func check(_ condition: Bool, _ message: String) { if !condition { fatalError(message) } }
func rejects(_ action: () throws -> Void) { do { try action(); fatalError("Expected failure") } catch {} }
let args = CommandLine.arguments
let root = URL(fileURLWithPath: args[1])
let fixture = URL(fileURLWithPath: args[2])
let wav = try Data(contentsOf: fixture.appendingPathExtension("wav"))
let sidecar = try Data(contentsOf: fixture.appendingPathExtension("forget"))
let summary: [String: Any] = ["id": "golden/bar", "name": "Golden bar", "createdAt": 1234, "bpm": 110, "complete": false, "bytes": wav.count + sidecar.count]
var store = try NativeBarFiles(root: root)
let save = try store.beginBarSave(summary: summary, wavBytes: wav.count, sidecarBytes: sidecar.count)
try store.append(transferId: save, part: "wav", offset: 0, data: wav)
check(try store.list().isEmpty, "An incomplete pair is never listed")
rejects { try store.commit(transferId: save) }
try store.append(transferId: save, part: "sidecar", offset: 0, data: sidecar)
try store.commit(transferId: save)
store = try NativeBarFiles(root: root)
check(try store.list().count == 1, "Committed pair survives store restart")
let pair = try store.read(id: "golden/bar")
for (part, expected) in [("wav", wav), ("sidecar", sidecar)] {
    let descriptor = pair[part] as! [String: Any]
    let handle = descriptor["handle"] as! String
    check(try store.readChunk(handle: handle, offset: 0, length: expected.count) == expected, "Exact golden bytes survive native storage")
    store.release(handles: [handle])
    rejects { _ = try store.readChunk(handle: handle, offset: 0, length: 1) }
}
rejects { _ = try store.beginBarSave(summary: summary, wavBytes: wav.count, sidecarBytes: sidecar.count) }
print("Native store: atomic complete pair, exact golden bytes, restart, duplicate and released handles pass")
let pendingSummary: [String: Any] = ["id": "abandoned", "name": "Incomplete", "createdAt": 1235, "bpm": 120, "complete": true, "bytes": wav.count + sidecar.count]
let pending = try store.beginBarSave(summary: pendingSummary, wavBytes: wav.count, sidecarBytes: sidecar.count)
rejects { try store.append(transferId: pending, part: "wav", offset: 1, data: wav) }
rejects { try store.append(transferId: pending, part: "audio", offset: 0, data: wav) }
try store.append(transferId: pending, part: "wav", offset: 0, data: wav)
store = try NativeBarFiles(root: root)
check(try store.list().count == 1, "Abandoned partial write does not replace a saved bar")
rejects { try store.commit(transferId: pending) }
let picked = try store.copySelected(url: fixture.appendingPathExtension("wav"))
let pickedHandle = picked["handle"] as! String
check(try store.readChunk(handle: pickedHandle, offset: 0, length: wav.count) == wav, "Picker uses only the selected bytes")
store.release(handles: [pickedHandle])
let exported = try store.exportPair(id: "golden/bar")
check(exported.urls.map { $0.pathExtension } == ["wav", "forget"], "One native chooser gets both matching files")
check(try Data(contentsOf: exported.urls[0]) == wav, "Export retains exact audio bytes")
store.release(handles: exported.handles)
check(try store.list().count == 1, "Cancelled export cannot remove the saved pair")
check(try root.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true, "Private audio is excluded from automatic backup")
let bad = try store.beginDecode(name: "bad.m4a", byteLength: 4)
try store.append(transferId: bad, part: "audio", offset: 0, data: Data([0, 1, 2, 3]))
rejects { _ = try store.finishDecode(transferId: bad) }
rejects { try store.append(transferId: bad, part: "audio", offset: 0, data: Data([0])) }
let failSave = try store.beginBarSave(summary: pendingSummary, wavBytes: wav.count, sidecarBytes: sidecar.count)
try store.append(transferId: failSave, part: "wav", offset: 0, data: wav)
try store.append(transferId: failSave, part: "sidecar", offset: 0, data: sidecar)
let library = root.appendingPathComponent("library")
try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: library.path)
rejects { try store.commit(transferId: failSave) }
try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: library.path)
store.abort(transferId: failSave)
check(try store.list().count == 1, "A failed atomic rename cannot erase the previous pair")
for index in 1..<100 {
    var next = summary; next["id"] = "entry-\(index)"
    let id = try store.beginBarSave(summary: next, wavBytes: wav.count, sidecarBytes: sidecar.count)
    try store.append(transferId: id, part: "wav", offset: 0, data: wav)
    try store.append(transferId: id, part: "sidecar", offset: 0, data: sidecar)
    try store.commit(transferId: id)
}
check(try store.list().count == 100, "Native library retains all admitted bars")
rejects { _ = try store.beginBarSave(summary: pendingSummary, wavBytes: wav.count, sidecarBytes: sidecar.count) }
let committed = try FileManager.default.contentsOfDirectory(at: library, includingPropertiesForKeys: nil)[0]
try Data("corrupt".utf8).write(to: committed.appendingPathComponent("summary.json"))
rejects { _ = try store.list() }
print("Native store: backup exclusion, decode failure cleanup, atomic rename failure, 100-bar quota and corrupt-manifest errors pass")
