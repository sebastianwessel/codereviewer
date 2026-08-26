package com.example;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public class FileService {
    private final Path baseDir;

    public FileService(Path baseDir) {
        this.baseDir = baseDir;
    }

    public byte[] readUserFile(String fileName) throws IOException {
        Path target = baseDir.resolve(fileName);
        return Files.readAllBytes(target);
    }
}
