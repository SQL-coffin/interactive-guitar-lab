"""Evaluation and benchmarking for note-event detection.

Kept separate from production inference (services/audio-worker). Only `detectors.py` imports
the worker; matching, metrics, annotation validation and reporting are pure and audio-free.
"""
