import Foundation
import Security

let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: NSUserName(),
    kSecAttrService as String: "media-hub-agent-token-server-growup",
    kSecReturnData as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne,
]

var result: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &result)
guard status == errSecSuccess,
      let data = result as? Data,
      let token = String(data: data, encoding: .utf8),
      token.hasPrefix("mh_agent_") else {
    fputs("Server Media Hub Agent Token is unavailable\n", stderr)
    exit(1)
}

print(token)
