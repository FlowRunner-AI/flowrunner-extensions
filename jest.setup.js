'use strict'

// Silence console output during tests to reduce noise
jest.spyOn(console, 'log').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'debug').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
// Keep console.error visible so real failures are obvious