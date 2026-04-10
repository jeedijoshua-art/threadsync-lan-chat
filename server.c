#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <ifaddrs.h>

#define PORT 8080
#define THREAD_COUNT 5
#define MAX_QUEUE 20

int queue[MAX_QUEUE];
int front = 0, rear = 0;

pthread_mutex_t lock;
pthread_mutex_t log_lock;
pthread_cond_t cond;

int total_requests = 0;
pthread_mutex_t stats_lock;

#define MAX_TRACKED_IPS 100
#define IP_TIMEOUT_SECONDS 30
typedef struct {
    char ip[INET_ADDRSTRLEN];
    time_t last_seen;
} ClientInfo;

ClientInfo active_ips[MAX_TRACKED_IPS];
int active_clients_count = 0;

// Worker thread function
void* worker(void* arg) {
    while (1) {
        pthread_mutex_lock(&lock);

        while (front == rear) {
            pthread_cond_wait(&cond, &lock);
        }

        int client_socket = queue[front];
        front = (front + 1) % MAX_QUEUE;

        pthread_mutex_unlock(&lock);

        char buffer[1024] = {0};
        read(client_socket, buffer, sizeof(buffer));

        char method[16] = {0};
        char path[256] = {0};
        sscanf(buffer, "%15s %255s", method, path);

        if (strstr(path, "favicon.ico") || strstr(path, "apple-touch-icon")) {
            char *res = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
            send(client_socket, res, strlen(res), 0);
            close(client_socket);
            continue;
        }

        struct sockaddr_in addr;
        socklen_t addr_size = sizeof(struct sockaddr_in);
        char client_ip[INET_ADDRSTRLEN] = "Unknown";
        if (getpeername(client_socket, (struct sockaddr *)&addr, &addr_size) == 0) {
            strcpy(client_ip, inet_ntoa(addr.sin_addr));
        }

        pthread_mutex_lock(&stats_lock);
        total_requests++;
        
        // Remove expired IPs
        time_t current_time = time(NULL);
        for (int i = 0; i < active_clients_count; i++) {
            if (current_time - active_ips[i].last_seen > IP_TIMEOUT_SECONDS) {
                // Swap with last element and remove
                active_ips[i] = active_ips[active_clients_count - 1];
                active_clients_count--;
                i--; // recheck new moved element
            }
        }

        // Add or update current IP
        int found = 0;
        for (int i = 0; i < active_clients_count; i++) {
            if (strcmp(active_ips[i].ip, client_ip) == 0) {
                active_ips[i].last_seen = current_time;
                found = 1;
                break;
            }
        }
        if (!found && active_clients_count < MAX_TRACKED_IPS && strcmp(client_ip, "Unknown") != 0) {
            strcpy(active_ips[active_clients_count].ip, client_ip);
            active_ips[active_clients_count].last_seen = current_time;
            active_clients_count++;
        }

        int current_total_requests = total_requests;
        int current_active_clients = active_clients_count;
        pthread_mutex_unlock(&stats_lock);

        time_t now = time(NULL);
        char time_str[64];
        strftime(time_str, sizeof(time_str), "%Y-%m-%d %H:%M:%S", localtime(&now));
        
        pthread_mutex_lock(&log_lock);
        FILE *log_file = fopen("server.log", "a");
        if (log_file) {
            fprintf(log_file, "[%s] Thread ID: %lu, Method: %s, Path: %s\n", 
                    time_str, (unsigned long)pthread_self(), method, path);
            fclose(log_file);
        }
        pthread_mutex_unlock(&log_lock);

//-------------------------------------------------------------------------------------
FILE *file = fopen("index.html", "r");
if (!file) {
    perror("File not found");
    close(client_socket);
    return NULL;
}

// Read file
char html[65536];
size_t len = fread(html, 1, sizeof(html) - 1, file);
html[len] = '\0';
fclose(file);

// Prepare dynamic values
char thread_id_str[50];
char thread_count_str[50];
char total_requests_str[50];
char active_clients_str[50];

sprintf(thread_id_str, "%lu", (unsigned long)pthread_self());
sprintf(thread_count_str, "%d", THREAD_COUNT);
sprintf(total_requests_str, "%d", current_total_requests);
sprintf(active_clients_str, "%d", current_active_clients);

// Replace THREAD_ID
char *pos;
while ((pos = strstr(html, "THREAD_ID")) != NULL) {
    char temp[65536];
    int index = pos - html;

    temp[0] = '\0';
    strncat(temp, html, index);
    strcat(temp, thread_id_str);
    strcat(temp, pos + strlen("THREAD_ID"));

    strcpy(html, temp);
}

// Replace THREAD_COUNT
while ((pos = strstr(html, "THREAD_COUNT")) != NULL) {
    char temp[65536];
    int index = pos - html;

    temp[0] = '\0';
    strncat(temp, html, index);
    strcat(temp, thread_count_str);
    strcat(temp, pos + strlen("THREAD_COUNT"));

    strcpy(html, temp);
}

// Replace TOTAL_REQUESTS
while ((pos = strstr(html, "TOTAL_REQUESTS")) != NULL) {
    char temp[65536];
    int index = pos - html;

    temp[0] = '\0';
    strncat(temp, html, index);
    strcat(temp, total_requests_str);
    strcat(temp, pos + strlen("TOTAL_REQUESTS"));

    strcpy(html, temp);
}

// Replace ACTIVE_CLIENTS
while ((pos = strstr(html, "ACTIVE_CLIENTS")) != NULL) {
    char temp[65536];
    int index = pos - html;

    temp[0] = '\0';
    strncat(temp, html, index);
    strcat(temp, active_clients_str);
    strcat(temp, pos + strlen("ACTIVE_CLIENTS"));

    strcpy(html, temp);
}

// Send response
char header[256];
sprintf(header, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: %zu\r\n\r\n", strlen(html));
send(client_socket, header, strlen(header), 0);

send(client_socket, html, strlen(html), 0);
        

        close(client_socket);

//-------------------------------------------------------------
    }
}

// Main function
int main() {
    int server_fd, client_socket;
    struct sockaddr_in address;
    int addrlen = sizeof(address);

    pthread_mutex_init(&lock, NULL);
    pthread_mutex_init(&log_lock, NULL);
    pthread_cond_init(&cond, NULL);
    pthread_mutex_init(&stats_lock, NULL);

    // Create thread pool
    pthread_t threads[THREAD_COUNT];
    for (int i = 0; i < THREAD_COUNT; i++) {
        if (pthread_create(&threads[i], NULL, worker, NULL) != 0) {
            perror("Thread creation failed");
            exit(EXIT_FAILURE);
        }
    }

    // Create socket
    if ((server_fd = socket(AF_INET, SOCK_STREAM, 0)) == 0) {
        perror("Socket failed");
        exit(EXIT_FAILURE);
    }

    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(PORT);

    if (bind(server_fd, (struct sockaddr*)&address, sizeof(address)) < 0) {
        perror("Bind failed");
        exit(EXIT_FAILURE);
    }

    if (listen(server_fd, 10) < 0) {
        perror("Listen failed");
        exit(EXIT_FAILURE);
    }

    struct ifaddrs *ifaddr, *ifa;
    if (getifaddrs(&ifaddr) == -1) {
        perror("getifaddrs");
        printf("🚀 Server running on http://localhost:%d\n", PORT);
    } else {
        printf("🚀 Server running on:\n");
        printf("   - Local: http://localhost:%d\n", PORT);
        for (ifa = ifaddr; ifa != NULL; ifa = ifa->ifa_next) {
            if (ifa->ifa_addr == NULL) continue;
            if (ifa->ifa_addr->sa_family == AF_INET && strcmp(ifa->ifa_name, "lo0") != 0) {
                char *ip = inet_ntoa(((struct sockaddr_in *)ifa->ifa_addr)->sin_addr);
                printf("   - LAN:   http://%s:%d\n", ip, PORT);
            }
        }
        freeifaddrs(ifaddr);
    }

    while (1) {
        client_socket = accept(server_fd, (struct sockaddr*)&address, (socklen_t*)&addrlen);

        if (client_socket < 0) {
            perror("Accept failed");
            continue;
        }



        pthread_mutex_lock(&lock);

        int next = (rear + 1) % MAX_QUEUE;
        if (next == front) {
            printf("⚠️ Queue full! Dropping request\n");

            close(client_socket);
        } else {
            queue[rear] = client_socket;
            rear = next;
            pthread_cond_signal(&cond);
        }

        pthread_mutex_unlock(&lock);
    }

    close(server_fd);
    return 0;
}
