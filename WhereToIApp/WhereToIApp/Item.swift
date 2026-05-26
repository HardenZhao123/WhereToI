//
//  Item.swift
//  WhereToIApp
//
//  Created by Ximin Li on 26/05/2026.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}
